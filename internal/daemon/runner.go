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
	"sort"
	"strings"
	"sync"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/robfig/cron/v3"

	"github.com/junkerderprovinz/reeveroll/internal/apply"
	"github.com/junkerderprovinz/reeveroll/internal/engine"
	"github.com/junkerderprovinz/reeveroll/internal/history"
	"github.com/junkerderprovinz/reeveroll/internal/job"
	"github.com/junkerderprovinz/reeveroll/internal/notify"
	"github.com/junkerderprovinz/reeveroll/internal/plan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

// ErrAlreadyRunning is returned when a job is asked for while the same job is
// still going.
//
// This is a normal outcome, not a fault. A job scheduled every fifteen minutes
// that takes twenty must not start a second copy of itself: two runs over one
// pair of folders would race each other through the same files and the state
// database, and the answer is simply to let this tick go by.
var ErrAlreadyRunning = errors.New("this job is still running from last time")

// Runner executes jobs, one at a time by default.
type Runner struct {
	cfg  *job.Config
	hist *history.DB
	note notify.Notifier
	log  func(format string, args ...any)

	slots chan struct{}

	mu       sync.Mutex
	inflight map[string]bool
}

// New builds a runner. hist and note may be nil, which turns off the run log
// and the notifications respectively.
func New(cfg *job.Config, hist *history.DB, note notify.Notifier, log func(string, ...any)) *Runner {
	if log == nil {
		log = func(string, ...any) {}
	}
	return &Runner{
		cfg:      cfg,
		hist:     hist,
		note:     note,
		log:      log,
		slots:    make(chan struct{}, cfg.ParallelJobs),
		inflight: map[string]bool{},
	}
}

// Run executes one job by name and returns what it did.
//
// The record is written whatever happens, including on failure, because "this
// job has been failing every quarter of an hour since Tuesday" is exactly the
// thing a history is for.
func (r *Runner) Run(ctx context.Context, name string) (history.Run, error) {
	j, ok := r.cfg.Find(name)
	if !ok {
		return history.Run{}, fmt.Errorf("no job called %q", name)
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

	rec := history.Run{Job: name, Started: time.Now()}
	res, p, err := r.execute(ctx, j)
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
		if hErr := r.hist.Record(ctx, rec); hErr != nil {
			r.log("could not write the run record for %s: %v", name, hErr)
		}
	}
	r.announce(ctx, rec, res)
	return rec, err
}

// execute does the actual sync for one job.
func (r *Runner) execute(ctx context.Context, j job.Job) (apply.Result, *plan.Plan, error) {
	opt, err := j.Options()
	if err != nil {
		return apply.Result{}, nil, err
	}
	// Each job gets its own copy of rclone's settings, so one job asking for
	// eight transfers or for metadata does not quietly change another's.
	ctx = engine.Configure(ctx, opt)

	left, err := rclonefs.NewFs(ctx, j.Left)
	if err != nil {
		return apply.Result{}, nil, fmt.Errorf("left side %q: %w", j.Left, err)
	}
	right, err := rclonefs.NewFs(ctx, j.Right)
	if err != nil {
		return apply.Result{}, nil, fmt.Errorf("right side %q: %w", j.Right, err)
	}
	db, err := state.Open(ctx, j.State)
	if err != nil {
		return apply.Result{}, nil, err
	}
	defer db.Close()

	p, res, err := engine.Once(ctx, apply.Ends{Left: left, Right: right}, db, opt)
	return res, p, err
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
	if !rec.Failed() && !r.cfg.Notify.OnSuccess {
		return
	}

	subject := fmt.Sprintf("ReeveRoll: %s finished", rec.Job)
	if rec.Failed() {
		subject = fmt.Sprintf("ReeveRoll: %s FAILED", rec.Job)
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

// Serve runs every scheduled job until the context is cancelled.
//
// A job with no schedule is not started here at all; it exists to be asked for
// by name. A job that is still running when its next turn comes round is
// skipped with a line in the log rather than queued, because queueing would let
// a job that is simply too slow build an unbounded backlog of itself.
func (r *Runner) Serve(ctx context.Context) error {
	c := cron.New()
	var scheduled []string

	for _, j := range r.cfg.Jobs {
		if j.Disabled || j.Schedule == "" {
			continue
		}
		name := j.Name
		schedule, err := job.ParseSchedule(j.Schedule)
		if err != nil {
			return fmt.Errorf("job %q: %w", name, err)
		}
		c.Schedule(schedule, cron.FuncJob(func() {
			rec, err := r.Run(ctx, name)
			switch {
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
		}))
		scheduled = append(scheduled, fmt.Sprintf("%s (%s)", name, j.Schedule))
	}

	sort.Strings(scheduled)
	if len(scheduled) == 0 {
		r.log("no job has a schedule, so nothing will run on its own")
	} else {
		r.log("scheduled: %s", strings.Join(scheduled, ", "))
	}

	c.Start()
	<-ctx.Done()
	// Stop returns a context that closes once the running jobs are done, so a
	// stop signal does not cut a transfer in half if it can be helped.
	stopped := c.Stop()
	select {
	case <-stopped.Done():
	case <-time.After(2 * time.Minute):
		r.log("a job was still running after two minutes, stopping anyway")
	}
	return nil
}
