// Package daemon runs jobs unattended: on a schedule or on a change, one run
// per job at a time, with each run recorded and failures reported.
package daemon

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/fspath"
	"github.com/robfig/cron/v3"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/hook"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/notify"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
	"github.com/junkerderprovinz/arrowloop/internal/watch"
)

// ErrAlreadyRunning is returned when a job is asked for while the same job is
// still going. Two runs over one pair of folders would race through the same
// files and state database, so the tick is let go by.
var ErrAlreadyRunning = errors.New("this job is still running from last time")

// ErrVolumeMissing is returned when a job points at a removable drive or a
// share that is not attached right now. It is not recorded as a failure,
// because a disk in somebody's bag has not gone wrong.
var ErrVolumeMissing = errors.New("the volume this job points at is not attached")

// ErrHalfWritten is returned when a job without both sides is asked to run.
var ErrHalfWritten = errors.New("this job has not been given both sides yet")

// Runner executes jobs, one at a time by default.
type Runner struct {
	// cond is asked before every automatic run and never before a hand-started
	// one. The desktop build sets it, since only it can tell battery and
	// metered connections.
	condMu sync.Mutex
	cond   Condition

	// waiting remembers the jobs whose drive was not attached, so the interface
	// can say "waiting for a drive".
	waiting waiting

	cfg  *job.Config
	hist *history.DB
	note notify.Notifier
	log  func(format string, args ...any)

	slots chan struct{}

	// reload carries one pending rebuild. Buffered by one and dropped when
	// full: two edits in quick succession need one rebuild, not two.
	reload chan struct{}

	mu sync.Mutex
	// inflight holds, per running job, the way to stop it.
	inflight map[string]context.CancelFunc
	subs     map[chan Event]struct{}
	watchers map[string]*watch.Watcher
}

// New builds a runner. hist and note may be nil, which turns off the run log
// and the notifications respectively.
func New(cfg *job.Config, hist *history.DB, note notify.Notifier, log func(string, ...any)) *Runner {
	if log == nil {
		log = func(string, ...any) {}
	}

	// Volumes are remembered beside the configuration, so a drive that is not
	// plugged in can still be named by its label. The registry is per process,
	// and so is the runner.
	volume.SetRegistry(filepath.Join(filepath.Dir(cfg.Path()), "volumes.json"))

	return &Runner{
		cfg:      cfg,
		hist:     hist,
		note:     note,
		log:      log,
		slots:    make(chan struct{}, cfg.ParallelJobs),
		inflight: map[string]context.CancelFunc{},
		reload:   make(chan struct{}, 1),
	}
}

// Preview works out what a job would do and changes nothing. It plans afresh,
// so the preview describes the tree as it is now.
func (r *Runner) Preview(ctx context.Context, name string) (*plan.Plan, error) {
	j, ok := r.config().Find(name)
	if !ok {
		return nil, fmt.Errorf("no job called %q", name)
	}
	if j.Left == "" || j.Right == "" {
		return nil, fmt.Errorf("%w: %s", ErrHalfWritten, name)
	}
	opt, err := j.Options()
	if err != nil {
		return nil, err
	}
	ctx = engine.Configure(ctx, opt)

	ends, db, err := r.open(ctx, j)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	p, _, err := engine.Prepare(ctx, ends, db, opt)
	return p, err
}

// Run executes one job by name and returns what it did. The record is written
// whatever happens, failures included.
func (r *Runner) Run(ctx context.Context, name string) (history.Run, error) {
	return r.RunOnly(ctx, name, nil)
}

// RunOnly executes a job but touches only the listed paths; nil means all of
// them. It plans afresh and then filters rather than replaying the plan the
// caller was shown, since a file can change between the preview and the run.
func (r *Runner) RunOnly(ctx context.Context, name string, only []string) (history.Run, error) {
	return r.RunChosen(ctx, name, only, nil)
}

// RunChosen executes a job with the paths somebody ticked and the conflicts
// they decided. A resolution only applies to a path that is still a conflict,
// so a stale one from an older preview is ignored.
func (r *Runner) RunChosen(ctx context.Context, name string, only []string, resolve map[string]plan.Resolution) (history.Run, error) {
	j, ok := r.config().Find(name)
	if !ok {
		return history.Run{}, fmt.Errorf("no job called %q", name)
	}
	if j.Left == "" || j.Right == "" {
		return history.Run{}, fmt.Errorf("%w: %s", ErrHalfWritten, name)
	}
	// rclone keeps its live transfer map per stats group, so without a group
	// two jobs syncing at once would each report the other's files.
	ctx = accounting.WithStatsGroup(ctx, "job/"+name)

	// The run's own context, so it can be stopped by name.
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	if !r.claim(name, stop) {
		return history.Run{}, ErrAlreadyRunning
	}
	defer r.release(name)

	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return history.Run{}, ctx.Err()
	}

	// The engine's own writes must not come back as a change.
	r.muteWatcher(name)
	defer r.muteWatcher(name)

	r.publish(Event{Job: name, Phase: "started"})
	rec := history.Run{Job: name, Started: time.Now()}
	var res apply.Result
	var p *plan.Plan
	err := hook.Run(ctx, j.Before, hookEnv(j, nil))
	if err != nil {
		err = fmt.Errorf("the command before the run failed, so the run did not start: %w", err)
	} else {
		res, p, err = r.execute(ctx, j, only, resolve)
	}

	// A drive that is not plugged in is not a run, so nothing is recorded.
	if errors.Is(err, ErrVolumeMissing) {
		r.publish(Event{Job: name, Phase: "finished", Error: err.Error()})
		return history.Run{}, err
	}

	rec.Finished = time.Now()
	if err != nil {
		rec.Err = err.Error()
	}
	if p != nil {
		rec.Unchanged = p.Unchanged
	}
	rec.Copied, rec.Moved, rec.Trashed = res.Copied, res.Moved, res.Trashed
	rec.Conflicts, rec.DirsMade, rec.DirsRemoved = res.Conflicts, res.DirsMade, res.DirsRemoved
	rec.Skipped = len(res.Skipped)

	// Runs even when the run was stopped, since cleaning up after it is what
	// the command is usually for.
	if aErr := hook.Run(context.WithoutCancel(ctx), j.After, hookEnv(j, &rec)); aErr != nil && rec.Err == "" {
		rec.Err = fmt.Sprintf("the command after the run failed: %v", aErr)
		err = errors.New(rec.Err)
	}

	if r.hist != nil {
		if hErr := r.hist.Record(ctx, rec, entriesOf(res)); hErr != nil {
			r.log("could not write the run record for %s: %v", name, hErr)
		}
	}
	r.announce(ctx, rec, res)
	finished := Event{Job: name, Phase: "finished", Run: &rec}
	if err != nil {
		finished.Error = err.Error()
	}
	r.publish(finished)
	return rec, err
}

// hookEnv is what a job's commands learn about it: the job always, and the
// outcome once there is a run to report.
func hookEnv(j job.Job, rec *history.Run) map[string]string {
	env := map[string]string{
		"ARROWLOOP_JOB":   j.Name,
		"ARROWLOOP_LEFT":  j.Left,
		"ARROWLOOP_RIGHT": j.Right,
	}
	if rec == nil {
		return env
	}
	env["ARROWLOOP_RESULT"] = "ok"
	if rec.Failed() {
		env["ARROWLOOP_RESULT"] = "failed"
	}
	env["ARROWLOOP_ERROR"] = rec.Err
	env["ARROWLOOP_COPIED"] = strconv.Itoa(rec.Copied)
	env["ARROWLOOP_MOVED"] = strconv.Itoa(rec.Moved)
	env["ARROWLOOP_DELETED"] = strconv.Itoa(rec.Trashed)
	env["ARROWLOOP_CONFLICTS"] = strconv.Itoa(rec.Conflicts)
	env["ARROWLOOP_SKIPPED"] = strconv.Itoa(rec.Skipped)
	return env
}

// entriesOf converts what a run did into log entries, so apply and history do
// not have to import each other.
func entriesOf(res apply.Result) []history.Entry {
	if len(res.Entries) == 0 {
		return nil
	}
	out := make([]history.Entry, 0, len(res.Entries))
	for _, e := range res.Entries {
		out = append(out, history.Entry{Kind: e.Kind, Side: e.Side, Path: e.Path, Note: e.Note, Size: e.Size})
	}
	return out
}

// open builds the two ends and the record for one job. Both sides are resolved
// before either is opened, because a drive letter since given to another disk
// would not look empty and the engine would reconcile against the wrong volume.
func (r *Runner) open(ctx context.Context, j job.Job) (apply.Ends, *state.DB, error) {
	leftPath, err := volume.Resolve(j.Left)
	if err != nil {
		return apply.Ends{}, nil, fmt.Errorf("%w: left side %s", ErrVolumeMissing, volume.Describe(j.Left))
	}
	rightPath, err := volume.Resolve(j.Right)
	if err != nil {
		return apply.Ends{}, nil, fmt.Errorf("%w: right side %s", ErrVolumeMissing, volume.Describe(j.Right))
	}

	left, err := rclonefs.NewFs(ctx, leftPath)
	if err != nil {
		return apply.Ends{}, nil, fmt.Errorf("left side %q: %w", leftPath, err)
	}
	right, err := rclonefs.NewFs(ctx, rightPath)
	if err != nil {
		return apply.Ends{}, nil, fmt.Errorf("right side %q: %w", rightPath, err)
	}
	db, err := state.Open(ctx, j.State)
	if err != nil {
		return apply.Ends{}, nil, err
	}
	return apply.Ends{Left: left, Right: right}, db, nil
}

// execute does the actual sync for one job, optionally limited to some paths.
func (r *Runner) execute(ctx context.Context, j job.Job, only []string, resolve map[string]plan.Resolution) (apply.Result, *plan.Plan, error) {
	opt, err := j.Options()
	if err != nil {
		return apply.Result{}, nil, err
	}
	// Per-job settings travel in the context, so two jobs running at once under
	// parallelJobs do not share them.
	ctx = engine.Configure(ctx, opt)
	ctx = apply.WithVersions(ctx, j.KeepVersions)
	ctx = apply.WithTrash(ctx, !j.NoTrash)

	ends, db, err := r.open(ctx, j)
	if err != nil {
		return apply.Result{}, nil, err
	}
	defer db.Close()

	// Started here because the right side has to be open to say which way a
	// file is going. The step counter is shared with the progress watcher.
	steps := &stepCount{}
	defer r.watchMoving(ctx, j.Name, ends.Right, steps)()

	watcher := progressFor{runner: r, job: j.Name, steps: steps}
	if only == nil && len(resolve) == 0 {
		p, res, err := engine.OnceWatched(ctx, ends, db, opt, watcher)
		return res, p, err
	}

	p, compare, err := engine.Prepare(ctx, ends, db, opt)
	if err != nil {
		return apply.Result{}, nil, err
	}
	if only != nil {
		full := len(p.Actions)
		keep(p, only)
		r.log("%s: running %d of %d proposed changes, as chosen", j.Name, len(p.Actions), full)
	}
	applyResolutions(p, resolve, r.log, j.Name)

	res, err := engine.ExecuteWatched(ctx, ends, db, p, compare, watcher)
	return res, p, err
}

// keep narrows a plan's actions to the paths somebody picked. The skips stay,
// because they report why a file was postponed rather than describe work.
func keep(p *plan.Plan, only []string) {
	wanted := make(map[string]bool, len(only))
	for _, path := range only {
		wanted[path] = true
	}
	kept := p.Actions[:0]
	for _, a := range p.Actions {
		if wanted[a.Path] {
			kept = append(kept, a)
		}
	}
	p.Actions = kept

	var dirs []plan.DirAction
	for _, d := range p.Dirs {
		// A record refresh moves nothing and keeps the directory state right.
		if d.Kind == plan.RecordDir || wanted[d.Path] {
			dirs = append(dirs, d)
		}
	}
	p.Dirs = dirs
}

// applyResolutions marks the conflicts a person decided. A resolution for a
// path that is no longer a conflict is ignored.
func applyResolutions(p *plan.Plan, resolve map[string]plan.Resolution, log func(string, ...any), name string) {
	if len(resolve) == 0 {
		return
	}
	var decided int
	for i := range p.Actions {
		if p.Actions[i].Kind != plan.Conflict {
			continue
		}
		if choice, ok := resolve[p.Actions[i].Path]; ok && choice != plan.KeepBoth {
			p.Actions[i].Resolve = choice
			decided++
		}
	}
	if decided > 0 {
		log("%s: resolving %d conflicts as chosen", name, decided)
	}
}

func (r *Runner) claim(name string, stop context.CancelFunc) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, running := r.inflight[name]; running {
		return false
	}
	r.inflight[name] = stop
	return true
}

// Cancel stops a run that is in progress, and says whether there was one. The
// run unwinds as on shutdown and is still recorded.
func (r *Runner) Cancel(name string) bool {
	r.mu.Lock()
	stop := r.inflight[name]
	r.mu.Unlock()
	if stop == nil {
		return false
	}
	r.log("%s: stopping, asked by hand", name)
	stop()
	return true
}

func (r *Runner) release(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.inflight, name)
}

// announce tells whoever is watching, if there is anything worth telling.
func (r *Runner) announce(ctx context.Context, rec history.Run, res apply.Result) {
	if r.note == nil {
		return
	}
	if !rec.Failed() && !r.config().Notify.OnSuccess {
		return
	}

	subject := fmt.Sprintf("ArrowLoop: %s finished", rec.Job)
	if rec.Failed() {
		subject = fmt.Sprintf("ArrowLoop: %s FAILED", rec.Job)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%d copied, %d moved, %d trashed, %d conflicts", rec.Copied, rec.Moved, rec.Trashed, rec.Conflicts)
	if rec.DirsMade+rec.DirsRemoved > 0 {
		fmt.Fprintf(&b, ", %d folders made, %d removed", rec.DirsMade, rec.DirsRemoved)
	}
	fmt.Fprintf(&b, ", %d unchanged, took %s", rec.Unchanged, rec.Finished.Sub(rec.Started).Round(time.Millisecond))
	if rec.Err != "" {
		fmt.Fprintf(&b, "\n%s", rec.Err)
	}
	// Only a handful of the postponed paths go to the chat room.
	if n := len(res.Skipped); n > 0 {
		fmt.Fprintf(&b, "\n%d left for the next run", n)
		for i, s := range res.Skipped {
			if i == 5 {
				fmt.Fprintf(&b, "\n  and %d more", n-i)
				break
			}
			fmt.Fprintf(&b, "\n  %s: %s", s.Path, s.Reason)
		}
	}

	if err := r.note.Send(ctx, subject, b.String()); err != nil {
		r.log("could not send the notification for %s: %v", rec.Job, err)
	}
}

// Serve runs every scheduled job until the context is cancelled, rebuilding
// itself whenever the configuration changes. A job still running when its next
// turn comes is skipped rather than queued, so a slow job cannot build a
// backlog of itself.
func (r *Runner) Serve(ctx context.Context) error {
	first := true
	for {
		round, endRound := context.WithCancel(ctx)
		c := r.schedule(round)
		c.Start()

		// Never on a reload, which happens every time a job is saved.
		if first {
			r.runAtStart(round)
			first = false
		}

		select {
		case <-ctx.Done():
			endRound()
			r.stopCron(c)
			return nil
		case <-r.reload:
			// Cancelling the round closes its watchers. Rebuilding from
			// scratch keeps one code path for start and restart.
			endRound()
			r.stopCron(c)
			r.mu.Lock()
			r.watchers = map[string]*watch.Watcher{}
			r.mu.Unlock()
			r.log("configuration reloaded")
		}
	}
}

// schedule builds the cron entries and the watchers for the current
// configuration.
func (r *Runner) schedule(ctx context.Context) *cron.Cron {
	cfg := r.config()
	c := cron.New()
	var scheduled []string

	for _, j := range cfg.Jobs {
		if j.Disabled || j.Schedule == "" {
			continue
		}
		name := j.Name
		parsed, err := job.ParseSchedule(j.Schedule)
		if err != nil {
			// Load refuses this, so carry on with the jobs that are fine.
			r.log("%s: unusable schedule %q: %v", name, j.Schedule, err)
			continue
		}
		c.Schedule(parsed, cron.FuncJob(func() { r.runAndReport(ctx, name) }))
		scheduled = append(scheduled, fmt.Sprintf("%s (%s)", name, j.Schedule))
	}

	for _, j := range cfg.Jobs {
		if j.Disabled || !j.Watch {
			continue
		}
		r.startWatcher(ctx, j)
	}

	// Pruned daily, since a container stays up for months while a watching
	// job writes a record per change.
	if keep, on := cfg.KeepHistoryFor(); on && r.hist != nil {
		c.Schedule(cron.Every(24*time.Hour), cron.FuncJob(func() {
			n, err := r.hist.Prune(ctx, keep, time.Now())
			if err != nil {
				r.log("could not trim the run log: %v", err)
				return
			}
			if n > 0 {
				r.log("trimmed %d run records older than %s from the log", n, keep)
			}
		}))
	}

	sort.Strings(scheduled)
	if len(scheduled) == 0 {
		r.log("no job has a schedule, so nothing will run on its own")
	} else {
		r.log("scheduled: %s", strings.Join(scheduled, ", "))
	}
	return c
}

// runAndReport runs one job automatically, writes the one log line its outcome
// is worth, and hands the outcome back. A missing volume, a held-back run and a
// job still running from last time are normal here, not failures.
func (r *Runner) runAndReport(ctx context.Context, name string) (history.Run, error) {
	rec, err := r.RunAutomatically(ctx, name)
	switch {
	case errors.Is(err, ErrHeldBack):
		r.log("%s: %v", name, err)
	case errors.Is(err, ErrNotEnoughSpace):
		r.log("%s did not start: %v", name, err)
	case errors.Is(err, ErrVolumeMissing):
		r.log("%s: %v", name, err)
	case errors.Is(err, ErrAlreadyRunning):
		r.log("%s is still running from last time, skipping this turn", name)
	case err != nil:
		r.log("%s failed: %v", name, err)
	case rec.Changed():
		r.log("%s: %d copied, %d moved, %d trashed, %d conflicts in %s",
			name, rec.Copied, rec.Moved, rec.Trashed, rec.Conflicts,
			rec.Finished.Sub(rec.Started).Round(time.Millisecond))
	default:
		r.log("%s: nothing to do", name)
	}
	return rec, err
}

// runAtStart runs the jobs asking to go as soon as the program does, one at a
// time in file order. It runs them in a goroutine so Serve can answer reloads
// while the first sync takes minutes.
func (r *Runner) runAtStart(ctx context.Context) {
	var due []string
	for _, j := range r.config().Jobs {
		if !j.Disabled && j.RunAtStart {
			due = append(due, j.Name)
		}
	}
	if len(due) == 0 {
		return
	}
	r.log("running at start: %s", strings.Join(due, ", "))
	go func() {
		for _, name := range due {
			if ctx.Err() != nil {
				return
			}
			r.runAndReport(ctx, name)
		}
	}()
}

// stopCron waits for whatever is running to finish rather than cutting it off.
func (r *Runner) stopCron(c *cron.Cron) {
	stopped := c.Stop()
	select {
	case <-stopped.Done():
	case <-time.After(2 * time.Minute):
		r.log("a job was still running after two minutes, stopping anyway")
	}
}

// Reload swaps in a new configuration and rebuilds the schedules and watchers.
// When a rebuild is already pending the signal is dropped, since that rebuild
// reads the new configuration anyway.
func (r *Runner) Reload(cfg *job.Config) {
	r.mu.Lock()
	r.cfg = cfg
	r.mu.Unlock()
	select {
	case r.reload <- struct{}{}:
	default:
	}
}

// Config returns the configuration currently in force.
func (r *Runner) Config() *job.Config { return r.config() }

func (r *Runner) config() *job.Config {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg
}

// MovingTick is how often the files in the air are published: often enough
// that a bar moves smoothly. A missed frame costs nothing, since the next one
// says where things are.
const MovingTick = 500 * time.Millisecond

// MovingBusy is how many finished steps in one tick mean rclone is not asked
// what is in flight. RemoteStats takes the lock every transfer takes, and
// reading it twice a second made a 600-file job take 25.6 seconds instead of
// 9.0. Files finishing that fast are done before a bar could move anyway.
const MovingBusy = 8

// watchMoving publishes what rclone has in the air until the returned function
// is called. It runs its own ticker because a large file finishes no steps for
// seconds at a time. Identical frames are dropped, and the reading is skipped
// while many steps finish in one tick; see MovingBusy.
func (r *Runner) watchMoving(ctx context.Context, name string, right rclonefs.Fs, steps *stepCount) func() {
	done := make(chan struct{})
	go func() {
		tick := time.NewTicker(MovingTick)
		defer tick.Stop()
		var last []engine.Moving
		lastRate := 0
		send := func(now []engine.Moving, rate int) {
			if sameMoving(last, now) && rate == lastRate {
				return
			}
			last, lastRate = now, rate
			r.publish(Event{Job: name, Phase: "moving", Moving: now, Rate: rate})
		}
		since := time.Now()
		for {
			select {
			case <-done:
				// One last empty frame clears the rows on the screen.
				if len(last) > 0 || lastRate > 0 {
					r.publish(Event{Job: name, Phase: "moving", Moving: []engine.Moving{}})
				}
				return
			case <-ctx.Done():
				return
			case <-tick.C:
				now := time.Now()
				elapsed := now.Sub(since)
				since = now
				count, files := steps.takeAndReset()
				if count >= MovingBusy {
					// The rows are cleared and the rate goes out instead, so
					// the empty space does not read as a stall.
					send(nil, perSecond(files, elapsed))
					continue
				}
				send(engine.InFlight(ctx, right), 0)
			}
		}
	}()
	return func() { close(done) }
}

// stepCount is how many pieces of work finished since it was last read,
// written by the workers and read by the ticker. n counts every step and
// decides whether rclone is asked at all; files counts only what moved bytes,
// which is the rate a person reads.
type stepCount struct {
	mu    sync.Mutex
	n     int
	files int
}

// add counts one finished step of the given kind.
func (s *stepCount) add(kind string) {
	s.mu.Lock()
	s.n++
	if kind == "copy" || kind == "move" {
		s.files++
	}
	s.mu.Unlock()
}

// takeAndReset returns the steps and the file transfers since the last read,
// and empties both.
func (s *stepCount) takeAndReset() (int, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, files := s.n, s.files
	s.n, s.files = 0, 0
	return n, files
}

// perSecond turns a count over a measured span into a rate. The span is
// measured because a phone under load delivers a tick late; it is not positive
// when the clock steps backwards.
func perSecond(count int, over time.Duration) int {
	if count <= 0 || over <= 0 {
		return 0
	}
	return int(float64(count)/over.Seconds() + 0.5)
}

// sameMoving says whether two readings, byte counts included, would draw the
// same rows.
func sameMoving(a, b []engine.Moving) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Event is something worth telling a watching screen about.
type Event struct {
	Job   string       `json:"job"`
	Phase string       `json:"phase"` // "started", "progress" or "finished"
	Run   *history.Run `json:"run,omitempty"`
	Error string       `json:"error,omitempty"`

	// Filled on a progress event. Total is known before the first byte moves,
	// because the plan is built first.
	Done  int    `json:"done,omitempty"`
	Total int    `json:"total,omitempty"`
	Kind  string `json:"kind,omitempty"`
	Path  string `json:"path,omitempty"`
	// Side is where the work lands. Empty for a step that touches neither
	// side, such as writing a record.
	Side string `json:"side,omitempty"`

	// Moving is what is in the air right now, on a "moving" event; rclone runs
	// several transfers at once. An empty list means the rows are gone, and
	// omitempty sends it as a frame with no moving field, which a reader takes
	// as empty.
	Moving []engine.Moving `json:"moving,omitempty"`

	// Rate is file transfers a second, on a "moving" frame that carries no
	// rows because too much is moving to read. It tells that apart from
	// nothing moving.
	Rate int `json:"rate,omitempty"`
}

// progressFor turns the apply stage's reports into events on the stream. Every
// step is published; publish drops a send that would block.
type progressFor struct {
	runner *Runner
	job    string
	// steps counts what finishes, for the in-flight ticker. It may be nil.
	steps *stepCount
}

func (p progressFor) Starting(total int) {
	p.runner.publish(Event{Job: p.job, Phase: "progress", Done: 0, Total: total})
}

func (p progressFor) Did(kind, path, side string, done, total int) {
	if p.steps != nil {
		p.steps.add(kind)
	}
	p.runner.publish(Event{Job: p.job, Phase: "progress", Done: done, Total: total, Kind: kind, Path: path, Side: side})
}

// Subscribe returns a channel of events and the function that stops it. A send
// that would block is dropped, so a browser tab that stopped reading can never
// hold up a transfer.
func (r *Runner) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 32)
	r.mu.Lock()
	if r.subs == nil {
		r.subs = map[chan Event]struct{}{}
	}
	r.subs[ch] = struct{}{}
	r.mu.Unlock()

	return ch, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if _, live := r.subs[ch]; live {
			delete(r.subs, ch)
			close(ch)
		}
	}
}

func (r *Runner) publish(ev Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for ch := range r.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Running reports which jobs are going right now.
func (r *Runner) Running() map[string]bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]bool, len(r.inflight))
	for name := range r.inflight {
		out[name] = true
	}
	return out
}

// localRoots returns the sides of a job that live on a real filesystem. It
// parses rather than connects, so starting the daemon does not reach out to a
// remote.
func localRoots(j job.Job) []string {
	var out []string
	for _, side := range []string{j.Left, j.Right} {
		// A volume that is not attached is skipped without complaint.
		resolved, err := volume.Resolve(side)
		if err != nil {
			continue
		}
		parsed, err := fspath.Parse(resolved)
		if err != nil || parsed.ConfigString != "" {
			continue
		}
		abs, err := filepath.Abs(parsed.Path)
		if err != nil {
			continue
		}
		out = append(out, filepath.Clean(abs))
	}
	return out
}

// startWatcher makes one job react to changes as well as to the clock. Only a
// local side can be watched, and the schedule stays behind it.
func (r *Runner) startWatcher(ctx context.Context, j job.Job) {
	roots := localRoots(j)
	if len(roots) == 0 {
		r.log("%s asks to be watched but has no local side; the schedule alone will have to do", j.Name)
		return
	}
	opt, err := j.Options()
	if err != nil {
		r.log("%s: %v", j.Name, err)
		return
	}

	name := j.Name
	w, err := watch.New(watch.Options{
		Roots:    roots,
		Exclude:  opt.Exclude,
		Settle:   j.SettleFor(),
		Cooldown: 5 * time.Second,
		Log:      func(format string, args ...any) { r.log(name+": "+format, args...) },
	}, func() {
		rec, err := r.RunAutomatically(ctx, name)
		switch {
		case errors.Is(err, ErrAlreadyRunning):
			// The change arrived while the job was already working on it.
		case err != nil:
			r.log("%s failed after a change: %v", name, err)
		case rec.Changed():
			r.log("%s: %d copied, %d moved, %d trashed after a change", name, rec.Copied, rec.Moved, rec.Trashed)
		}
	})
	if err != nil {
		r.log("%s: %v", name, err)
		return
	}

	r.mu.Lock()
	if r.watchers == nil {
		r.watchers = map[string]*watch.Watcher{}
	}
	r.watchers[name] = w
	r.mu.Unlock()

	r.log("%s: watching %d folder(s) across %d local side(s)", name, w.Watching(), len(roots))
	go func() {
		defer w.Close()
		if err := w.Run(ctx); err != nil {
			r.log("%s: watching stopped: %v", name, err)
		}
	}()
}

// muteWatcher stops a job's own writes coming back as a change that runs the
// job again.
func (r *Runner) muteWatcher(name string) {
	r.mu.Lock()
	w := r.watchers[name]
	r.mu.Unlock()
	if w != nil {
		w.Mute()
	}
}
