package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Running what the clock should already have run.
//
// It exists for a phone. On a server the engine is always up, so its own cron
// fires and nothing is ever missed; on a phone the engine may not be running at
// three in the morning at all, because a process that runs all night is a
// process that needs a permanent notification hanging in the shade - which is
// the one thing an app like this must not have.
//
// So the phone hands the SCHEDULING to Android, which is the only thing on a
// phone allowed to wake anything, and the engine keeps the SCHEDULE. Android
// says "now would be a good time"; this works out which jobs that applies to.
// One definition of when a job runs, in the cron expression the person wrote,
// and no second copy on the Kotlin side to drift away from it.

// Due is the jobs whose schedule has come round since they last succeeded.
//
// A job that has never run and has a schedule counts as due: the first run has
// to happen at some point, and waiting a whole cycle to do something the person
// asked for the moment they saved it reads as an app that ignored them.
func (r *Runner) Due(ctx context.Context, now time.Time) []string {
	var due []string
	for _, j := range r.config().Jobs {
		if j.Disabled || j.Schedule == "" {
			continue
		}
		parsed, err := job.ParseSchedule(j.Schedule)
		if err != nil {
			// Load refuses anything unparseable, so reaching here means the
			// file changed underneath us. Saying so beats a job that quietly
			// stops being scheduled.
			r.log("%s: unusable schedule %q: %v", j.Name, j.Schedule, err)
			continue
		}
		last, ok, err := r.lastSuccess(ctx, j.Name)
		if err != nil {
			// The history is unreadable. Treating that as "not due" would mean
			// a broken log silently stops every schedule, so the opposite: run
			// it. A run too many costs a comparison; a run too few costs a
			// night's backup.
			r.log("%s: cannot read when it last succeeded (%v), treating it as due", j.Name, err)
			due = append(due, j.Name)
			continue
		}
		if !ok {
			due = append(due, j.Name)
			continue
		}
		// Would the cron have fired between then and now? `Next` answers the
		// first time at or after the moment it is given, so a next-after-last
		// that has already passed is a tick this job missed.
		if next := parsed.Next(last); !next.After(now) {
			due = append(due, j.Name)
		}
	}
	return due
}

// RunDue runs them, one at a time, and reports how many it ran.
//
// Serialised for the same reason every other run in this program is: two jobs
// at once share one uplink and one disk, and on a phone they also share a
// wake-up whose length somebody is paying for in battery.
//
// It blocks. The caller is a wake-up that has to know when it may let the phone
// sleep again, and a function that returned early would have it report success
// while the copying was still going on.
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
			// None of these is a failure, and saying so on a phone would train
			// somebody to ignore the notification that matters. A drive in a
			// bag has not gone wrong.
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

// Due is what a wake-up can tell somebody once it is over.
//
// A count alone was enough while nothing reported anything: the phone woke, ran
// what was due and went back to sleep. It is not enough for a notification,
// which has to distinguish "four jobs copied nine files" from "four jobs and
// one of them failed" - and a background run that fails silently is the exact
// complaint this program exists to prevent.
//
// Held is deliberately its own number rather than a failure. A job waiting for
// a drive, for the charger or for its own previous run is doing what somebody
// asked it to do.
type Due struct {
	Ran       int `json:"ran"`
	Failed    int `json:"failed"`
	Held      int `json:"held"`
	Copied    int `json:"copied"`
	Moved     int `json:"moved"`
	Trashed   int `json:"trashed"`
	Conflicts int `json:"conflicts"`
	// The first failure's sentence, which is what a notification shows. One
	// rather than all of them: a notification is a line, not a log.
	Reason string `json:"reason,omitempty"`
}

// Changed says whether anything actually moved, which is the difference
// between a notification worth posting and a quiet night.
func (d Due) Changed() bool {
	return d.Copied+d.Moved+d.Trashed+d.Conflicts > 0
}

// lastSuccess is the history lookup with the nil check in one place: a runner
// built without a history (which the tests do) has never succeeded at anything.
func (r *Runner) lastSuccess(ctx context.Context, name string) (time.Time, bool, error) {
	if r.hist == nil {
		return time.Time{}, false, nil
	}
	return r.hist.LastSuccess(ctx, name)
}
