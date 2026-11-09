package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
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
// interface can say "waiting for a drive" and the scheduler can run the job
// once the drive is back.
type waiting struct {
	mu   sync.Mutex
	when map[string]time.Time
	// gone is, per job, the folders a run found missing, which have to be
	// back before the job is. attached cannot tell, since outside Windows a
	// path does not name its drive.
	gone map[string][]plan.GoneError
}

// note marks a job as waiting from at, unless it already was, and adds the
// folders found gone that it did not know of.
func (w *waiting) note(name string, at time.Time, gone ...plan.GoneError) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.when == nil {
		w.when = map[string]time.Time{}
		w.gone = map[string][]plan.GoneError{}
	}
	if _, already := w.when[name]; !already {
		w.when[name] = at
	}
	for _, g := range gone {
		if !slices.Contains(w.gone[name], g) {
			w.gone[name] = append(w.gone[name], g)
		}
	}
}

func (w *waiting) clear(name string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.when, name)
	delete(w.gone, name)
}

// Since reports how long a job has been waiting for its drive, if it is.
func (w *waiting) Since(name string) (time.Time, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	at, ok := w.when[name]
	return at, ok
}

func (w *waiting) folders(name string) []plan.GoneError {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]plan.GoneError(nil), w.gone[name]...)
}

// WaitingFor reports whether this job is waiting for a drive to be attached,
// and since when.
func (r *Runner) WaitingFor(name string) (time.Time, bool) { return r.waiting.Since(name) }

// waitForDrive marks a job as waiting for its drive, and for the folder a run
// found gone if err names one. A watch on the drive ends with the drive, so
// the job's watcher is started again once it is back.
func (r *Runner) waitForDrive(name string, err error) {
	var found []plan.GoneError
	var gone *plan.GoneError
	if errors.As(err, &gone) {
		found = append(found, *gone)
	}
	r.waiting.note(name, time.Now(), found...)
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

// away says which side of a job is not there: a drive that is not attached,
// or a folder a run found gone that has not come back.
func (r *Runner) away(j job.Job) error {
	if err := attached(j); err != nil {
		return err
	}
	for _, gone := range r.waiting.folders(j.Name) {
		if _, err := os.Stat(gone.Root); err != nil {
			return fmt.Errorf("%w: %w", ErrVolumeMissing, &gone)
		}
	}
	return nil
}

// attached reports whether both of a job's sides are there right now. The
// engine checks again when it opens the sides, since a drive can be unplugged
// in between.
func attached(j job.Job) error {
	_, _, err := resolve(j)
	return err
}

// offline reports whether a side on this machine lives on a drive or a share
// that is not there. A missing folder on a drive that is there is the target
// of a new job, which its first run makes. Only Windows names the drive in
// the path; elsewhere the engine finds a known side gone when it lists it.
func offline(side string) bool {
	root, local := localFolder(side)
	if !local {
		return false
	}
	if _, err := os.Stat(root); err == nil {
		return false
	}
	drive := filepath.VolumeName(root)
	if drive == "" {
		return false
	}
	_, err := os.Stat(drive + string(filepath.Separator))
	return err != nil && !errors.Is(err, os.ErrPermission)
}
