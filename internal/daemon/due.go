package daemon

import (
	"context"
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
func (r *Runner) RunDue(ctx context.Context) int {
	due := r.Due(ctx, time.Now())
	if len(due) == 0 {
		r.log("nothing is due")
		return 0
	}
	r.log("due now: %s", strings.Join(due, ", "))
	ran := 0
	for _, name := range due {
		if ctx.Err() != nil {
			break
		}
		r.runAndLog(ctx, name)
		ran++
	}
	return ran
}

// lastSuccess is the history lookup with the nil check in one place: a runner
// built without a history (which the tests do) has never succeeded at anything.
func (r *Runner) lastSuccess(ctx context.Context, name string) (time.Time, bool, error) {
	if r.hist == nil {
		return time.Time{}, false, nil
	}
	return r.hist.LastSuccess(ctx, name)
}
