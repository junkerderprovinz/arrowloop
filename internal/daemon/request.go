package daemon

import (
	"context"
	"errors"
	"fmt"
	"time"
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
	cfg := r.config()
	j, ok := cfg.Find(name)
	switch {
	case !ok:
		return false, fmt.Errorf("%w: %s", ErrNoSuchJob, name)
	case !cfg.RunsOnItsOwn(j):
		return false, fmt.Errorf("%w: %s", ErrPaused, j.Name)
	}
	if r.keepRequest(j.Key()) {
		r.log("%s: asked for by %s, runs again once this run ends", j.Name, by)
		return true, nil
	}
	r.log("%s: asked for by %s", j.Name, by)
	go r.runRequested(j.Key())
	return false, nil
}

// keepRequest notes a request for the job if it is running, for release to
// answer, and reports whether it did.
func (r *Runner) keepRequest(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, running := r.inflight[key]; !running {
		return false
	}
	r.requested[key] = true
	return true
}

// runRequested runs a requested job. When another run claims the job first,
// the request waits for that one. Another process says nothing when its run
// ends, so a job running there is asked again a little later.
func (r *Runner) runRequested(key string) {
	_, err := r.runAndReport(context.Background(), key)
	switch {
	case errors.Is(err, ErrRunningElsewhere):
		time.AfterFunc(elsewhereRetry, func() { r.runRequested(key) })
	case errors.Is(err, ErrAlreadyRunning) && !r.keepRequest(key):
		go r.runRequested(key)
	}
}

// elsewhereRetry is how long a request waits for a job another process is
// running.
const elsewhereRetry = 30 * time.Second
