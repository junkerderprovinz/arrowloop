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
// a state somebody asked it not to sync in.
//
// Its own error, not a failure. Nothing is wrong: the laptop is on battery, or
// the connection is one somebody pays for by the megabyte. A log full of
// "failed" for a machine behaving exactly as instructed teaches people to stop
// reading the log.
var ErrHeldBack = errors.New("held back by a condition on this machine")

// Condition is asked before every AUTOMATIC run, and never before a run somebody
// started by hand.
//
// A function rather than a set of flags in the configuration, because the
// answers live in two different worlds. Whether a machine is on battery or on a
// metered connection is a question only the desktop build can ask, through
// Windows APIs the container has no equivalent for, and the engine must not grow
// a build tag to find that out. The desktop sets this; the container leaves it
// nil and nothing is ever held back.
//
// Returning an error holds the run. Returning nil lets it through.
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

// waiting remembers the jobs whose drive was not attached last time.
//
// A job on a removable disk is the one case where "it did not run" is completely
// normal and completely invisible: the drive is in a drawer, the schedule fires,
// nothing happens, and the next notice is a month later when somebody looks for
// a file. Remembering it lets the interface say "waiting for a drive" instead of
// showing a job that has simply never worked.
//
// It is deliberately not a retry loop. Polling every few seconds for a disk that
// is in a drawer is work a machine does for nothing, and the schedule is already
// asking often enough that plugging a drive in is noticed within one turn. What
// this adds is the WORDS for the state, which is what was missing.
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

// attached reports whether both of a job's sides can be resolved right now.
//
// Asked before a run rather than discovered during one, so that a job on a drive
// in a drawer produces a state somebody can read rather than an error in a log.
// The engine still checks again when it opens the sides, and that check is the
// one that matters: a drive can be unplugged between this question and that one,
// and only the later check is close enough to the work to be trusted.
func attached(j job.Job) error {
	if _, err := volume.Resolve(j.Left); err != nil {
		return err
	}
	if _, err := volume.Resolve(j.Right); err != nil {
		return err
	}
	return nil
}
