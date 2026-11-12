package daemon

import (
	"context"
	"errors"
	"fmt"
)

// ErrNoSuchJob and ErrPaused are why Request turns a request away.
var (
	ErrNoSuchJob = errors.New("there is no job by that name")
	ErrPaused    = errors.New("the job is paused")
)

// Request runs a job that another app asked for, as an automatic run. A job
// that is running keeps the request and runs once more when it ends, however
// many requests came meanwhile, so the files handed over during a run are
// carried as well. queued reports that the request waits for such a run. by
// names the asker in the log.
func (r *Runner) Request(name, by string) (queued bool, err error) {
	j, ok := r.config().Find(name)
	switch {
	case !ok:
		return false, fmt.Errorf("%w: %s", ErrNoSuchJob, name)
	case j.Disabled:
		return false, fmt.Errorf("%w: %s", ErrPaused, name)
	}
	if r.keepRequest(name) {
		r.log("%s: asked for by %s, runs again once this run ends", name, by)
		return true, nil
	}
	r.log("%s: asked for by %s", name, by)
	go r.runRequested(name)
	return false, nil
}

// keepRequest notes a request for name if the job is running, for release to
// answer, and reports whether it did.
func (r *Runner) keepRequest(name string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, running := r.inflight[name]; !running {
		return false
	}
	r.requested[name] = true
	return true
}

// runRequested runs a requested job. When another run claims the job first,
// the request waits for that one.
func (r *Runner) runRequested(name string) {
	_, err := r.runAndReport(context.Background(), name)
	if errors.Is(err, ErrAlreadyRunning) && !r.keepRequest(name) {
		go r.runRequested(name)
	}
}
