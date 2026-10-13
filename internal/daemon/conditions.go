package daemon

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// ErrHeldBack means a scheduled run was not started because the machine is in
// a state somebody asked it not to sync in, such as on battery. It is not a
// failure.
var ErrHeldBack = errors.New("held back by a condition on this machine")

// Condition is asked before every automatic run, and never before a run
// somebody started by hand. An error holds the run.
//
// It is a function because only the desktop build can ask Windows about the
// battery or a metered connection; the container leaves it nil.
type Condition func(ctx context.Context, j job.Job) error

// SetCondition installs the check. Passing nil removes it.
func (r *Runner) SetCondition(c Condition) {
	r.condMu.Lock()
	defer r.condMu.Unlock()
	r.cond = c
}

func (r *Runner) condition() Condition {
	r.condMu.Lock()
	defer r.condMu.Unlock()
	return r.cond
}

// waiting remembers the jobs whose drive was not attached last time, so the
// interface can say "waiting for a drive" and the scheduler can catch up the
// turn the drive was away for once it is back.
type waiting struct {
	mu   sync.Mutex
	when map[string]time.Time
}

func (w *waiting) note(name string, at time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.when == nil {
		w.when = map[string]time.Time{}
	}
	w.when[name] = at
}

func (w *waiting) clear(name string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.when, name)
}

// Since reports how long a job has been waiting for its drive, if it is.
func (w *waiting) Since(name string) (time.Time, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	at, ok := w.when[name]
	return at, ok
}

// WaitingFor reports whether this job is waiting for a drive to be attached,
// and since when.
func (r *Runner) WaitingFor(name string) (time.Time, bool) { return r.waiting.Since(name) }

// waitForDrive marks a job as waiting for its drive. A watch on the drive
// ends with the drive, so the job's watcher is started again once it is back.
func (r *Runner) waitForDrive(name string) {
	r.waiting.note(name, time.Now())
	j, ok := r.config().Find(name)
	if !ok {
		return
	}
	seen := localSides(j)
	r.mu.Lock()
	defer r.mu.Unlock()
	// The run has said the drive is missing, so what look finds gone is not
	// logged again.
	if w := r.watchers[name]; w != nil && w.failed == "" {
		w.look(seen)
	}
}

// attached reports whether both of a job's sides can be resolved right now. The
// engine checks again when it opens the sides, since a drive can be unplugged
// in between.
func attached(j job.Job) error {
	if _, err := volume.Resolve(j.Left); err != nil {
		return err
	}
	if _, err := volume.Resolve(j.Right); err != nil {
		return err
	}
	return nil
}
