package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Due is the jobs whose schedule has come round since they last succeeded. On
// a phone the engine is not running at night, so Android wakes it and this
// works out which jobs are due from the cron expressions, leaving one
// definition of the schedule. A scheduled job that has never run is due.
//
// It and Retrying list the jobs by their Key.
func (r *Runner) Due(ctx context.Context, now time.Time) []string {
	var due []string
	for _, j := range r.config().Jobs {
		if r.owed(ctx, j, now) {
			due = append(due, j.Key())
		}
	}
	return due
}

// owed reports whether a job is due, which Due describes.
func (r *Runner) owed(ctx context.Context, j job.Job, now time.Time) bool {
	if !r.config().RunsOnItsOwn(j) || j.Schedule == "" {
		return false
	}
	parsed, err := job.ParseSchedule(j.Schedule)
	if err != nil {
		r.log("%s: unusable schedule %q: %v", j.Name, j.Schedule, err)
		return false
	}
	key := j.Key()
	last, ok, err := r.lastSuccess(ctx, key)
	if err != nil {
		// A broken log must not stop every schedule: a run too many costs
		// a comparison, a run too few a night's backup.
		r.log("%s: cannot read when it last succeeded (%v), treating it as due", j.Name, err)
		return true
	}
	// A next tick after the last success that has already passed is a tick
	// this job missed. A stopped run took its tick, though its work is still
	// owed at the next one.
	turn := last
	if r.hist != nil {
		if stopped, was, err := r.hist.LastStopped(ctx, key); err == nil && was && stopped.After(turn) {
			turn, ok = stopped, true
		}
	}
	if ok {
		if next := parsed.Next(turn); next.After(now) {
			return false
		}
	}
	// For a job that never worked, last is the zero time and every failure
	// counts.
	if r.backingOff(ctx, j, last, parsed, now) {
		return false
	}
	// A held job is looked at once per scheduled turn, to see whether what
	// held it has gone. It never succeeds while held, and without this a
	// phone would list both sides at every wake-up.
	if seen, held := r.Held(key); held && parsed.Next(seen).After(now) {
		return false
	}
	return true
}

// backingOff reports whether a job that is otherwise due should be left alone
// because it has just failed: it is still inside the wait after a failure, or
// out of attempts until its next scheduled time. A failed job stays owed until
// it works, and without this limit a phone would wake all night for a remote
// that is down. An unreadable history does not back off.
func (r *Runner) backingOff(ctx context.Context, j job.Job, since time.Time, parsed cron.Schedule, now time.Time) bool {
	if r.hist == nil {
		return false
	}
	fails, lastFail, err := r.hist.FailuresSince(ctx, j.Key(), since)
	if err != nil {
		r.log("%s: cannot read its failures (%v), trying it", j.Name, err)
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

// Retrying is the scheduled jobs whose last run failed, that have tries left
// and whose wait after the failure is over. A computer or a container that
// stays up has no wake-up asking Due and its clock fires only on each job's own
// turns, so the scheduler asks this every minute.
func (r *Runner) Retrying(ctx context.Context, now time.Time) []string {
	if r.hist == nil {
		return nil
	}
	cfg := r.config()
	policy := cfg.Retry
	running := r.Running()
	var due []string
	for _, j := range cfg.Jobs {
		key := j.Key()
		if !cfg.RunsOnItsOwn(j) || j.Schedule == "" || running[j.Name] {
			continue
		}
		// An unreadable log is no reason to run, and the scheduled turns
		// report it.
		last, _, err := r.lastSuccess(ctx, key)
		if err != nil {
			continue
		}
		fails, lastFail, err := r.hist.FailuresSince(ctx, key, last)
		if err != nil || fails == 0 || fails > policy.AttemptCount() {
			continue
		}
		if lastFail.Add(policy.WaitFor(fails)).After(now) {
			continue
		}
		due = append(due, key)
	}
	return due
}

// catchUp runs the jobs whose drive is back, once each, for the turn they lost
// while it was away; after that they keep to their schedule. A computer's
// clock only fires on each job's own turns, so the scheduler asks this every
// minute, which is how often a drive coming back is noticed.
func (r *Runner) catchUp(ctx context.Context) {
	for _, key := range r.returned() {
		if ctx.Err() != nil {
			return
		}
		r.log("%s: its drive is back, catching up the run it missed", r.nameOf(key))
		r.runAndReport(ctx, key)
	}
}

// returned is the jobs waiting for a drive that is there again. A job with a
// before command is left to its turn, since the command may be what attaches
// the drive.
func (r *Runner) returned() []string {
	cfg := r.config()
	running := r.Running()
	var back []string
	for _, j := range cfg.Jobs {
		if _, waits := r.waiting.Since(j.Key()); !waits {
			continue
		}
		if !cfg.RunsOnItsOwn(j) || j.Before != "" || running[j.Name] || r.away(j) != nil {
			continue
		}
		back = append(back, j.Key())
	}
	return back
}

// RunDue runs the due jobs one at a time and reports what happened. It blocks,
// because the wake-up calling it has to know when the phone may sleep again.
func (r *Runner) RunDue(ctx context.Context) Due {
	// A phone's engine has no clock ticking between wake-ups, so the look at
	// the schedules happens here.
	r.overdue(ctx, time.Now())
	r.backUpIfDue(time.Now())
	due := r.Due(ctx, time.Now())
	if len(due) == 0 {
		r.log("nothing is due")
		return Due{Found: r.drainTold()}
	}
	names := make([]string, len(due))
	for i, key := range due {
		names[i] = r.nameOf(key)
	}
	r.log("due now: %s", strings.Join(names, ", "))
	var out Due
	for i, key := range due {
		if ctx.Err() != nil {
			break
		}
		name := names[i]
		rec, err := r.runAndReport(ctx, key)
		out.Ran++
		o := Outcome{Job: name, Run: rec, Err: err}
		out.Jobs = append(out.Jobs, o)
		switch {
		case errors.Is(err, ErrWithdrawn):
			// Removed or paused while it waited, so nothing ran.
		case o.Skipped():
			out.Held++
		case err != nil && r.noNetwork(ctx, key):
			// The network went while the job ran, as on a phone switched to
			// flight mode for the night. Nobody has anything to fix, and the
			// job stays owed until a run works.
			out.Held++
		case err != nil:
			out.Failed++
			if out.Reason == "" {
				out.Reason = fmt.Sprintf("%s: %v", name, err)
			}
		default:
			out.Copied += rec.Copied
			out.Moved += rec.Moved
			if rec.NoTrash {
				out.Deleted += rec.Trashed
			} else {
				out.Trashed += rec.Trashed
			}
			out.Conflicts += rec.Conflicts
		}
	}
	out.Found = r.drainTold()
	return out
}

// noNetwork reports whether the run conditions would now hold a job for want of
// a network.
func (r *Runner) noNetwork(ctx context.Context, key string) bool {
	cond := r.condition()
	j, ok := r.config().Find(key)
	return cond != nil && ok && errors.Is(cond(ctx, j), job.ErrNoNetwork)
}

// Due is what a wake-up can tell somebody once it is over. Held counts jobs
// waiting for a drive, the charger, a network or their own previous run, which
// are not failures.
type Due struct {
	Ran     int `json:"ran"`
	Failed  int `json:"failed"`
	Held    int `json:"held"`
	Copied  int `json:"copied"`
	Moved   int `json:"moved"`
	Trashed int `json:"trashed"`
	// Deleted is what jobs without a trash removed for good, which Trashed
	// leaves out.
	Deleted   int `json:"deleted"`
	Conflicts int `json:"conflicts"`
	// Reason is the first failure's message, which a notification shows.
	Reason string `json:"reason,omitempty"`
	// Found is what the wake-up found that somebody should hear of: a job a
	// brake holds, or a note where notes are reported.
	Found []Found `json:"found,omitempty"`
	// Jobs is what each job came to, in the order they ran.
	Jobs []Outcome `json:"-"`
}

// Outcome is what one job of a wake-up came to. Err is the reason a run
// failed or never started.
type Outcome struct {
	Job string
	Run history.Run
	Err error
}

// Skipped reports whether the job did not run for a reason that is not a
// failure: its drive is away, something holds it, it is already running, or it
// was paused or removed while it waited.
func (o Outcome) Skipped() bool {
	for _, reason := range []error{ErrHeldBack, ErrVolumeMissing, ErrAlreadyRunning, ErrHeld, ErrWithdrawn} {
		if errors.Is(o.Err, reason) {
			return true
		}
	}
	return false
}

// Changed says whether anything moved, and so whether a notification is worth
// posting.
func (d Due) Changed() bool {
	return d.Copied+d.Moved+d.Trashed+d.Deleted+d.Conflicts > 0
}

// lastSuccess is the history lookup; a runner without a history has never
// succeeded.
func (r *Runner) lastSuccess(ctx context.Context, key string) (time.Time, bool, error) {
	if r.hist == nil {
		return time.Time{}, false, nil
	}
	return r.hist.LastSuccess(ctx, key)
}
