// Package daemon runs jobs on a schedule and remembers what happened.
//
// The engine underneath knows how to sync one pair of folders once. Everything
// here is about doing that unattended: not letting a slow job pile up on itself,
// not letting two jobs fight over one uplink, writing down what each run did,
// and telling somebody when a run fails.
package daemon

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/fspath"
	"github.com/robfig/cron/v3"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/notify"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
	"github.com/junkerderprovinz/arrowloop/internal/watch"
)

// ErrAlreadyRunning is returned when a job is asked for while the same job is
// still going.
//
// This is a normal outcome, not a fault. A job scheduled every fifteen minutes
// that takes twenty must not start a second copy of itself: two runs over one
// pair of folders would race each other through the same files and the state
// database, and the answer is simply to let this tick go by.
var ErrAlreadyRunning = errors.New("this job is still running from last time")

// ErrVolumeMissing is returned when a job points at a removable drive or a
// share that is not attached right now.
//
// This is not a failure and is deliberately not recorded as one. A disk in
// somebody's bag has not gone wrong, and a job that reported a failure every
// quarter of an hour for the days between two backups would train its owner to
// ignore the very notification that matters when something really breaks. One
// line in the log, no history row, no message.
var ErrVolumeMissing = errors.New("the volume this job points at is not attached")

// ErrHalfWritten says a job has not been finished being set up.
//
// A switched-off job is allowed to be missing a side, because that is the state
// of every job between being created and being filled in. Asking for it to run
// anyway has to say so plainly, rather than handing an empty string to a
// backend and reporting whatever that backend makes of it.
var ErrHalfWritten = errors.New("this job has not been given both sides yet")

// Runner executes jobs, one at a time by default.
type Runner struct {
	// cond is asked before every automatic run and never before a hand-started
	// one. Set by the desktop build, which is the only one that can ask whether
	// this machine is on battery or on a connection somebody pays for.
	condMu sync.Mutex
	cond   Condition

	// waiting remembers the jobs whose drive was not attached, so the interface
	// can say "waiting for a drive" instead of showing a job that has never
	// worked.
	waiting waiting

	cfg  *job.Config
	hist *history.DB
	note notify.Notifier
	log  func(format string, args ...any)

	slots chan struct{}

	// reload carries one pending rebuild. Buffered by one and dropped when
	// full: two edits in quick succession need one rebuild, not two.
	reload chan struct{}

	mu       sync.Mutex
	inflight map[string]bool
	subs     map[chan Event]struct{}
	watchers map[string]*watch.Watcher
}

// New builds a runner. hist and note may be nil, which turns off the run log
// and the notifications respectively.
func New(cfg *job.Config, hist *history.DB, note notify.Notifier, log func(string, ...any)) *Runner {
	if log == nil {
		log = func(string, ...any) {}
	}

	// Volumes are remembered beside the configuration, so that a drive which
	// is not plugged in can still be named by the label its owner gave it. The
	// register belongs to the process rather than to this runner, and there is
	// one runner per process, so here is where it is set.
	volume.SetRegistry(filepath.Join(filepath.Dir(cfg.Path()), "volumes.json"))

	return &Runner{
		cfg:      cfg,
		hist:     hist,
		note:     note,
		log:      log,
		slots:    make(chan struct{}, cfg.ParallelJobs),
		inflight: map[string]bool{},
		reload:   make(chan struct{}, 1),
	}
}

// Preview works out what a job would do and changes nothing.
//
// This is the screen a person actually decides from: every action with its
// direction and its reason, before a single byte moves. It re-plans rather than
// handing back something cached, because a preview is only worth looking at if
// it describes the tree as it is now.
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

// Run executes one job by name and returns what it did.
//
// The record is written whatever happens, including on failure, because "this
// job has been failing every quarter of an hour since Tuesday" is exactly the
// thing a history is for.
func (r *Runner) Run(ctx context.Context, name string) (history.Run, error) {
	return r.RunOnly(ctx, name, nil)
}

// RunOnly executes a job but touches only the listed paths.
//
// It re-plans first and then filters, rather than replaying a plan the caller
// was shown earlier. That matters: between somebody reading a preview and
// pressing the button, a file can change, and acting on the older plan would
// mean acting on a description of a tree that no longer exists. Filtering by
// path keeps the person's choice while letting the engine decide afresh what
// that path now needs.
//
// A nil list means everything, which is what Run passes.
func (r *Runner) RunOnly(ctx context.Context, name string, only []string) (history.Run, error) {
	return r.RunChosen(ctx, name, only, nil)
}

// RunChosen executes a job with the paths somebody ticked and the conflicts
// they decided.
//
// A resolution is keyed by path and only ever reaches a conflict. Everything
// else in the plan is untouched by it, so a stale entry from a preview taken a
// minute ago costs nothing: the path either still disagrees, in which case the
// decision still applies, or it does not, in which case there is no conflict to
// resolve and the entry is ignored.
func (r *Runner) RunChosen(ctx context.Context, name string, only []string, resolve map[string]plan.Resolution) (history.Run, error) {
	j, ok := r.config().Find(name)
	if !ok {
		return history.Run{}, fmt.Errorf("no job called %q", name)
	}
	if j.Left == "" || j.Right == "" {
		return history.Run{}, fmt.Errorf("%w: %s", ErrHalfWritten, name)
	}
	if !r.claim(name) {
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
	res, p, err := r.execute(ctx, j, only, resolve)

	// A drive that is not plugged in is not a run. Nothing is written down and
	// nobody is told, because there is nothing to tell.
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

// entriesOf carries what a run did across the one package boundary that stands
// between the engine and the log.
//
// A conversion rather than a shared type, because apply and history have no
// business importing each other: one of them applies a plan and the other keeps
// a database, and the day a column is added to one of them is not a day the
// other should have to rebuild.
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

// open builds the two ends and the record for one job.
//
// Both sides are resolved before either is opened. A job on a removable drive
// has to be stopped BEFORE anything is listed: if the drive is gone and the
// engine went ahead, the empty-side guard would catch it, but a drive letter
// that has since been handed to a different disk would not be empty at all, and
// the engine would happily reconcile against the wrong volume.
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
	// The first-run choice, applied here so it covers every way a run starts.
	// The first run is the first run whoever presses the button, and a seed
	// that only worked on the schedule would be a setting that behaves
	// differently depending on how somebody happened to begin.
	j = seed(j)

	opt, err := j.Options()
	if err != nil {
		return apply.Result{}, nil, err
	}
	// Each job gets its own copy of rclone's settings, so one job asking for
	// eight transfers or for metadata does not quietly change another's.
	ctx = engine.Configure(ctx, opt)
	// How many old contents to keep, carried the same way and for the same
	// reason: a package variable would be shared between two jobs running at
	// once under parallelJobs, and each job's answer is its own.
	ctx = apply.WithVersions(ctx, j.KeepVersions)
	// And whether this job keeps a trash at all, carried the same way for the
	// same reason. Note the inversion: the field says what NOT to do, so that a
	// configuration written before it existed reads as "keep one".
	ctx = apply.WithTrash(ctx, !j.NoTrash)

	ends, db, err := r.open(ctx, j)
	if err != nil {
		return apply.Result{}, nil, err
	}
	defer db.Close()

	watcher := progressFor{runner: r, job: j.Name}
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

// keep narrows a plan to the paths somebody picked.
//
// Only the actions are filtered. The agreed list is left alone because it moves
// nothing, and the skips are left alone because they are a report rather than
// work: hiding the reason a file was postponed, just because the person did not
// tick that file, would make the run look tidier than it was.
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
		// A record refresh costs nothing and keeps the directory state honest,
		// so it survives whatever was ticked.
		if d.Kind == plan.RecordDir || wanted[d.Path] {
			dirs = append(dirs, d)
		}
	}
	p.Dirs = dirs
}

// applyResolutions marks the conflicts a person decided.
//
// Only conflicts are touched. A resolution naming a path that turned out to be
// an ordinary copy is not an error and not a warning: between the preview and
// the run the file may simply have stopped disagreeing, which is the good case.
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

func (r *Runner) claim(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inflight[name] {
		return false
	}
	r.inflight[name] = true
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
	// A handful of the postponed paths, not all of them: a run that postponed
	// four thousand files should not send four thousand lines to a chat room.
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
// itself whenever the configuration changes.
//
// A job with no schedule is not started here at all; it exists to be asked for
// by name. A job that is still running when its next turn comes round is
// skipped with a line in the log rather than queued, because queueing would let
// a job that is simply too slow build an unbounded backlog of itself.
func (r *Runner) Serve(ctx context.Context) error {
	first := true
	for {
		round, endRound := context.WithCancel(ctx)
		c := r.schedule(round)
		c.Start()

		// Only on the way in, never on a reload. A reload happens every time
		// somebody saves a job in the interface, and firing the start-up runs
		// again there would turn one edit into a sync of every job in the file
		// - including the twelve the person was not touching.
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
			// The watchers belong to this round's context, so cancelling it is
			// what closes them. Rebuilding from scratch rather than working out
			// what changed keeps one code path for "start" and "restart": two
			// paths would eventually disagree about what a reload leaves behind.
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
			// Load already refused anything unparseable, so reaching here means
			// the file changed underneath us in a way validation should have
			// caught. Say so and carry on with the jobs that are fine.
			r.log("%s: unusable schedule %q: %v", name, j.Schedule, err)
			continue
		}
		c.Schedule(parsed, cron.FuncJob(func() { r.runAndLog(ctx, name) }))
		scheduled = append(scheduled, fmt.Sprintf("%s (%s)", name, j.Schedule))
	}

	for _, j := range cfg.Jobs {
		if j.Disabled || !j.Watch {
			continue
		}
		r.startWatcher(ctx, j)
	}

	// The run log's own housekeeping, on a turn of its own.
	//
	// It used to happen once at startup and nowhere else, which suits a desktop
	// install somebody restarts and not the case this program mostly runs in: a
	// container that stays up for months while a watching job writes a record
	// per change. Daily rather than hourly because nothing here is urgent - the
	// file grows slowly and the point is only that it stops growing for ever.
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

// runAndLog runs one job by name and writes the one line a log reader wants.
//
// One function rather than a copy at each caller: the schedule tick and the
// start-up run report the same outcomes, and two copies of this switch would
// eventually disagree about which outcomes are worth a line. A missing volume
// and a job still running from last time are both NORMAL here and neither is a
// failure, which is exactly the distinction a second copy tends to lose.
func (r *Runner) runAndLog(ctx context.Context, name string) {
	// RunAutomatically rather than Run: this is the clock talking, and a job
	// marked report-only must not be applied by it.
	rec, err := r.RunAutomatically(ctx, name)
	switch {
	case errors.Is(err, ErrHeldBack):
		// Not a failure and not worth alarm: the machine is doing exactly what
		// somebody asked it to do. It still gets a line, because a job that
		// silently never runs is the thing this whole log exists to prevent.
		r.log("%s: %v", name, err)
	case errors.Is(err, ErrNotEnoughSpace):
		// Its own line, because this one is actionable and the others are not:
		// nothing was written, nothing is half done, and somebody has to free
		// space or the job will keep refusing every turn.
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
}

// runAtStart runs the jobs asking to go as soon as the program does.
//
// In its own goroutine, and that is the load-bearing part: Serve has to reach
// its select and start answering reloads immediately. Running these inline
// would leave the interface unable to save a job for as long as the first sync
// takes, which on a large folder over SFTP is minutes, and would look exactly
// like a program that hung on startup.
//
// One at a time in file order, because the alternative is every job in the file
// starting at once on one uplink and one disk. That is the same reason ordinary
// runs are serialised, and a start-up burst is the moment it matters most.
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
			r.runAndLog(ctx, name)
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
//
// The signal is dropped rather than queued when a rebuild is already pending:
// two edits in quick succession need one rebuild, not two, and the second one
// would rebuild from the same file anyway.
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

// Event is something worth telling a watching screen about.
type Event struct {
	Job   string       `json:"job"`
	Phase string       `json:"phase"` // "started", "progress" or "finished"
	Run   *history.Run `json:"run,omitempty"`
	Error string       `json:"error,omitempty"`

	// Filled on a progress event. Total is known before the first byte moves,
	// because the plan is built first: a bar whose total grows while it runs is
	// not a bar.
	Done  int    `json:"done,omitempty"`
	Total int    `json:"total,omitempty"`
	Kind  string `json:"kind,omitempty"`
	Path  string `json:"path,omitempty"`
	// Which side the work lands on, so a watching screen can say WHERE a file
	// is going rather than only that one is moving. Empty for a step that
	// touches neither side, such as writing a record.
	Side string `json:"side,omitempty"`
}

// progressFor turns the apply stage's reports into events on the stream.
//
// Every step is published rather than sampled. The stream already drops a send
// that would block, so a screen that cannot keep up loses frames instead of
// holding up a transfer, which is the right way round.
type progressFor struct {
	runner *Runner
	job    string
}

func (p progressFor) Starting(total int) {
	p.runner.publish(Event{Job: p.job, Phase: "progress", Done: 0, Total: total})
}

func (p progressFor) Did(kind, path, side string, done, total int) {
	p.runner.publish(Event{Job: p.job, Phase: "progress", Done: done, Total: total, Kind: kind, Path: path, Side: side})
}

// Subscribe returns a channel of events and the function that stops it.
//
// The channel is buffered and a send that would block is DROPPED rather than
// waited on. A browser tab that stopped reading, or a laptop that went to
// sleep mid-run, must never be able to hold up a transfer: the screen exists to
// report on the work, so it is the screen that gives way.
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

// localRoots returns the sides of a job that live on a real filesystem.
//
// Parsed rather than connected: fspath.Parse tells a local path from a remote
// without opening anything, so starting the daemon does not have to reach an
// S3 bucket just to find out that it is not a folder.
func localRoots(j job.Job) []string {
	var out []string
	for _, side := range []string{j.Left, j.Right} {
		// A volume path is local by definition, so it is worth watching as soon
		// as the drive is attached and not worth complaining about when it is
		// not.
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

// startWatcher makes one job react to changes instead of only to the clock.
//
// A watcher is an optimisation on top of the schedule and never a replacement
// for it: only a local side can be watched, and a watcher that missed an event
// has no way to know it did. The configuration refuses a watching job with no
// schedule for exactly that reason.
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
		// The watcher is automation too, so a report-only job reports rather
		// than writes when a folder changes under it.
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

// muteWatcher stops a job's own writes coming back as a change.
//
// Without this the engine answers itself: a run writes files, the watcher sees
// them, the job runs again. The second run finds nothing to do so it does
// terminate, but a job that reacts to every one of its own writes never sits
// still, and on a schedule of one change per second that is a lot of listing
// for no result.
func (r *Runner) muteWatcher(name string) {
	r.mu.Lock()
	w := r.watchers[name]
	r.mu.Unlock()
	if w != nil {
		w.Mute()
	}
}
