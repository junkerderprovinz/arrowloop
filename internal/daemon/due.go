package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Due is the jobs whose schedule has come round since they last succeeded. On
// a phone the engine is not running at night, so Android wakes it and this
// works out which jobs are due from the cron expressions, leaving one
// definition of the schedule. A scheduled job that has never run is due.
func (r *Runner) Due(ctx context.Context, now time.Time) []string {
	var due []string
	for _, j := range r.config().Jobs {
		if j.Disabled || j.Schedule == "" {
			continue
		}
		parsed, err := job.ParseSchedule(j.Schedule)
		if err != nil {
			r.log("%s: unusable schedule %q: %v", j.Name, j.Schedule, err)
			continue
		}
		last, ok, err := r.lastSuccess(ctx, j.Name)
		if err != nil {
			// A broken log must not stop every schedule: a run too many costs
			// a comparison, a run too few a night's backup.
			r.log("%s: cannot read when it last succeeded (%v), treating it as due", j.Name, err)
			due = append(due, j.Name)
			continue
		}
		// A next tick after the last success that has already passed is a
		// tick this job missed.
		if ok {
			if next := parsed.Next(last); next.After(now) {
				continue
			}
		}
		// For a job that never worked, last is the zero time and every
		// failure counts.
		if r.backingOff(ctx, j.Name, last, parsed, now) {
			continue
		}
		due = append(due, j.Name)
	}
	return due
}

// backingOff reports whether a job that is otherwise due should be left alone
// because it has just failed: it is still inside the wait after a failure, or
// out of attempts until its next scheduled time. A failed job stays owed until
// it works, and without this limit a phone would wake all night for a remote
// that is down. An unreadable history does not back off.
func (r *Runner) backingOff(ctx context.Context, name string, since time.Time, parsed cron.Schedule, now time.Time) bool {
	if r.hist == nil {
		return false
	}
	fails, lastFail, err := r.hist.FailuresSince(ctx, name, since)
	if err != nil {
		r.log("%s: cannot read its failures (%v), trying it", name, err)
		return false
	}
	if fails == 0 {
		return false
	}
	policy := r.config().Retry
	if fails > policy.AttemptCount() {
		// Out of tries: a nightly job that failed tonight tries again
		// tomorrow night.
		return parsed.Next(lastFail).After(now)
	}
	return lastFail.Add(policy.WaitFor(fails)).After(now)
}

// RunDue runs the due jobs one at a time and reports what happened. It blocks,
// because the wake-up calling it has to know when the phone may sleep again.
func (r *Runner) RunDue(ctx context.Context) Due {
	due := r.Due(ctx, time.Now())
	if len(due) == 0 {
		r.log("nothing is due")
		return Due{}
	}
	r.log("due now: %s", strings.Join(due, ", "))
	var out Due
	for _, name := range due {
		if ctx.Err() != nil {
			break
		}
		rec, err := r.runAndReport(ctx, name)
		out.Ran++
		switch {
		case errors.Is(err, ErrHeldBack), errors.Is(err, ErrVolumeMissing),
			errors.Is(err, ErrAlreadyRunning):
			// None of these is a failure.
			out.Held++
		case err != nil:
			out.Failed++
			if out.Reason == "" {
				out.Reason = fmt.Sprintf("%s: %v", name, err)
			}
		default:
			out.Copied += rec.Copied
			out.Moved += rec.Moved
			out.Trashed += rec.Trashed
			out.Conflicts += rec.Conflicts
		}
	}
	return out
}

// Due is what a wake-up can tell somebody once it is over. Held counts jobs
// waiting for a drive, the charger or their own previous run, which are not
// failures.
type Due struct {
	Ran       int `json:"ran"`
	Failed    int `json:"failed"`
	Held      int `json:"held"`
	Copied    int `json:"copied"`
	Moved     int `json:"moved"`
	Trashed   int `json:"trashed"`
	Conflicts int `json:"conflicts"`
	// Reason is the first failure's message, which a notification shows.
	Reason string `json:"reason,omitempty"`
}

// Changed says whether anything moved, and so whether a notification is worth
// posting.
func (d Due) Changed() bool {
	return d.Copied+d.Moved+d.Trashed+d.Conflicts > 0
}

// lastSuccess is the history lookup; a runner without a history has never
// succeeded.
func (r *Runner) lastSuccess(ctx context.Context, name string) (time.Time, bool, error) {
	if r.hist == nil {
		return time.Time{}, false, nil
	}
	return r.hist.LastSuccess(ctx, name)
}
