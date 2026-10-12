package daemon

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// ErrHeld is returned when a safety brake refused a run. The job stays held
// until somebody lets the change run or takes it back, or until a later run
// finds the cause gone. It is not a failure.
var ErrHeld = errors.New("held by a safety brake until somebody decides")

// brakes are the findings that hold a job.
var brakes = []anomaly.Kind{anomaly.Delete, anomaly.Change, anomaly.Empty}

// answer is how a run closes the findings whose brakes its plan got past.
type answer struct {
	outcome string
	kinds   []anomaly.Kind
}

// passed is the answer of an ordinary run: whatever held the job went away by
// itself.
var passed = answer{outcome: anomaly.Resolved, kinds: brakes}

// refusal turns a brake's refusal into the finding it makes.
func refusal(name string, err error) (anomaly.Finding, bool) {
	var brake *plan.BrakeError
	if errors.As(err, &brake) {
		return anomaly.Finding{
			Job: name, Kind: anomaly.Kind(brake.Kind),
			Count: brake.Count, Known: brake.Known, Limit: brake.Percent,
			OnLeft: brake.OnLeft, OnRight: brake.OnRight,
			Paths: brake.Paths, Mark: brake.Mark, Detail: brake.Error(),
		}, true
	}
	var empty *plan.EmptySideError
	if errors.As(err, &empty) {
		return anomaly.Finding{
			Job: name, Kind: anomaly.Empty, Side: empty.Side.String(),
			Known: max(empty.Known, empty.Held), Mark: empty.Mark(), Detail: empty.Error(),
		}, true
	}
	return anomaly.Finding{}, false
}

// hold records what a brake refused and tells whoever is watching, once.
func (r *Runner) hold(ctx context.Context, f anomaly.Finding) {
	stored, fresh := r.anomalies.Raise(f)
	r.noted(ctx, stored, fresh)
}

// noted publishes a change to the findings and sends the message a new one is
// worth.
func (r *Runner) noted(ctx context.Context, f anomaly.Finding, fresh bool) {
	if !fresh {
		r.publish(Event{Job: f.Job, Phase: "anomaly"})
		return
	}
	r.log("%s: %s", f.Job, f.Detail)
	r.mu.Lock()
	cfg, note := r.cfg, r.note
	r.mu.Unlock()
	tells := cfg.Anomalies.Tells(f.Held)
	ev := Event{Job: f.Job, Phase: "anomaly"}
	if tells {
		ev.Told = f.ID
		found := Found{Job: f.Job, Kind: string(f.Kind), Held: f.Held}
		r.mu.Lock()
		r.told = append(slices.DeleteFunc(r.told, func(o Found) bool { return o == found }), found)
		r.mu.Unlock()
	}
	r.publish(ev)
	if note == nil || !tells {
		return
	}
	subject := fmt.Sprintf("ArrowLoop: %s is held", f.Job)
	if !f.Held {
		subject = fmt.Sprintf("ArrowLoop: a note about %s", f.Job)
	}
	if err := note.Send(context.WithoutCancel(ctx), subject, f.Detail); err != nil {
		r.log("could not send the notification for %s: %v", f.Job, err)
	}
}

// Found is a new finding somebody should hear of.
type Found struct {
	Job  string `json:"job"`
	Kind string `json:"kind"`
	Held bool   `json:"held"`
}

// drainTold hands over the findings made since the last call that are still
// open. One answered in the meantime needs no telling.
func (r *Runner) drainTold() []Found {
	r.mu.Lock()
	told := r.told
	r.told = nil
	r.mu.Unlock()
	return slices.DeleteFunc(told, func(f Found) bool {
		return !r.anomalies.Has(f.Job, anomaly.Kind(f.Kind))
	})
}

// settle closes a job's findings of the given kinds and says so.
func (r *Runner) settle(name, outcome string, kinds ...anomaly.Kind) {
	if r.anomalies.Settle(name, outcome, kinds...) {
		r.publish(Event{Job: name, Phase: "anomaly"})
	}
}

// review makes or clears the note about a job that keeps failing, once a run
// has been recorded.
func (r *Runner) review(ctx context.Context, rec history.Run) {
	if !rec.Failed() {
		r.settle(rec.Job, anomaly.Resolved, anomaly.Failing, anomaly.Overdue)
		return
	}
	after := r.config().Anomalies.FailingCount()
	if after == 0 || r.hist == nil {
		return
	}
	last, _, err := r.lastSuccess(ctx, rec.Job)
	if err != nil {
		return
	}
	fails, _, err := r.hist.FailuresSince(ctx, rec.Job, last)
	if err != nil || fails < after {
		return
	}
	stored, fresh := r.anomalies.Raise(anomaly.Finding{
		Job: rec.Job, Kind: anomaly.Failing, Count: fails,
		Detail: fmt.Sprintf("the last %d runs failed: %s", fails, rec.Err),
	})
	r.noted(ctx, stored, fresh)
}

// overdue makes the note about a scheduled job whose turn came and went. A
// job that is held or keeps failing already says why it does not run, and one
// that never ran has no turn to have missed.
func (r *Runner) overdue(ctx context.Context, now time.Time) {
	cfg := r.config()
	after := cfg.Anomalies.OverdueAfter()
	if after == 0 || r.hist == nil {
		return
	}
	running := r.Running()
	for _, j := range cfg.Jobs {
		if j.Disabled || j.Schedule == "" {
			r.settle(j.Name, anomaly.Resolved, anomaly.Overdue)
			continue
		}
		if running[j.Name] || r.anomalies.Has(j.Name, anomaly.Failing) {
			continue
		}
		if _, held := r.anomalies.Holding(j.Name); held {
			continue
		}
		parsed, err := job.ParseSchedule(j.Schedule)
		if err != nil {
			continue
		}
		last, ok, err := r.lastSuccess(ctx, j.Name)
		if err != nil || !ok {
			continue
		}
		missed := now.Sub(parsed.Next(last))
		if missed <= after {
			continue
		}
		stored, fresh := r.anomalies.Raise(anomaly.Finding{
			Job: j.Name, Kind: anomaly.Overdue, Count: int(now.Sub(last).Hours() / 24),
			Detail: fmt.Sprintf("has not run since %s, though its schedule is %s", last.Format("2006-01-02 15:04"), j.Schedule),
		})
		r.noted(ctx, stored, fresh)
	}
}

// Findings lists what is open and what was closed lately, after a look at the
// schedules. A phone's engine has no clock ticking between wake-ups, so the
// look happens when somebody asks.
func (r *Runner) Findings(ctx context.Context) (open, closed []anomaly.Finding) {
	r.overdue(ctx, time.Now())
	cfg := r.config()
	open, closed = r.anomalies.List(func(name string) bool {
		_, ok := cfg.Find(name)
		return ok
	})
	if cfg.Anomalies.Off {
		// What still holds a job has to stay answerable; the notes made before
		// the switch wait unseen until it is on again.
		return slices.DeleteFunc(open, func(f anomaly.Finding) bool { return !f.Held }), nil
	}
	return open, closed
}

// Finding returns the open finding with this id.
func (r *Runner) Finding(id string) (anomaly.Finding, bool) { return r.anomalies.Find(id) }

// Held reports whether a brake holds this job, and since when its finding was
// last confirmed.
func (r *Runner) Held(name string) (time.Time, bool) {
	f, ok := r.anomalies.Holding(name)
	return f.Seen, ok
}

// Approve lets the change a brake refused run now. The permission covers the
// change as the finding shows it: if more has happened since, the brake
// refuses again and the finding shows the new figures. A run that overwrites
// in bulk keeps the content it replaces.
func (r *Runner) Approve(ctx context.Context, id string) (history.Run, error) {
	f, ok := r.anomalies.Find(id)
	if !ok || !f.Held {
		return history.Run{}, anomaly.ErrUnknown
	}
	marks, err := r.anomalies.Allow(id)
	if err != nil {
		return history.Run{}, err
	}
	how := decided{approved: marks, keepOne: true}
	return r.runAnswering(ctx, f.Job, false, answer{outcome: anomaly.Ran, kinds: brakes},
		func(ctx context.Context, j job.Job, live *history.Live) (apply.Result, *plan.Plan, error) {
			return r.executeAs(ctx, j, nil, nil, nil, how, live)
		})
}

// TakeBack undoes the change a brake refused, where it was made: the files one
// side lost are copied back from the other, and the files one side rewrote get
// the other side's version again, with the rewritten content kept as a
// version. Nothing is deleted.
func (r *Runner) TakeBack(ctx context.Context, id string) (history.Run, error) {
	f, ok := r.anomalies.Find(id)
	if !ok || !f.Held {
		return history.Run{}, anomaly.ErrUnknown
	}
	how := decided{back: plan.Brake(f.Kind), keepOne: true}
	return r.runAnswering(ctx, f.Job, false, answer{outcome: anomaly.TakenBack, kinds: []anomaly.Kind{f.Kind}},
		func(ctx context.Context, j job.Job, live *history.Live) (apply.Result, *plan.Plan, error) {
			return r.executeAs(ctx, j, nil, nil, nil, how, live)
		})
}

// Acknowledge closes a note somebody has seen.
func (r *Runner) Acknowledge(id string) error {
	f, ok := r.anomalies.Find(id)
	if !ok {
		return anomaly.ErrUnknown
	}
	if err := r.anomalies.Acknowledge(id); err != nil {
		return err
	}
	r.publish(Event{Job: f.Job, Phase: "anomaly"})
	return nil
}
