package daemon

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// RunAutomatically is what the clock and the watcher call.
//
// It exists to keep ONE distinction that a single Run method cannot carry: who
// asked. A job marked ReportOnly compares both sides on its schedule and
// applies nothing, and that restraint has to end the moment a person presses
// the button, because pressing the button IS the decision the flag exists to
// withhold from the clock. A single entry point serving both is how the
// automatic behaviour leaks into the manual one, and the leak is silent: the
// button appears to work and quietly does nothing.
//
// Everything a real run records is recorded here too. That is the point rather
// than a nicety: somebody who is not yet ready to let a job write still wants
// the log to say whether anything is drifting, and a report that leaves no
// trace answers nothing the next morning.
func (r *Runner) RunAutomatically(ctx context.Context, name string) (history.Run, error) {
	j, ok := r.config().Find(name)
	if !ok {
		return history.Run{}, fmt.Errorf("no job called %q", name)
	}
	if j.ReportOnly {
		return r.report(ctx, name)
	}
	// Room is checked only on the automatic path. A person pressing the button
	// with a full disk will read the error; the run that fills a disk is the one
	// nobody was watching. See roomFor for why the estimate belongs on the clock
	// side rather than in front of a person.
	if err := r.roomFor(ctx, j); err != nil {
		r.publish(Event{Job: name, Phase: "finished", Error: err.Error()})
		return history.Run{}, err
	}
	return r.Run(ctx, name)
}

// report compares both sides, writes down what a run WOULD have done, and
// touches nothing.
//
// It goes through the same claim, the same slot and the same watcher muting a
// real run does. Two report-only runs of one job at once would read the same
// tree twice for no reason, and a report that ignored the parallel-jobs setting
// would be the one job on the machine allowed to break it.
func (r *Runner) report(ctx context.Context, name string) (history.Run, error) {
	if !r.claim(name) {
		return history.Run{}, ErrAlreadyRunning
	}
	defer r.release(name)

	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		return history.Run{}, ctx.Err()
	}

	r.publish(Event{Job: name, Phase: "started"})
	rec := history.Run{Job: name, Started: time.Now()}

	p, err := r.Preview(ctx, name)
	rec.Finished = time.Now()

	// A drive that is not plugged in is not a run, here for the same reason it
	// is not one for a real run: there is nothing to tell.
	if errors.Is(err, ErrVolumeMissing) {
		r.publish(Event{Job: name, Phase: "finished", Error: err.Error()})
		return history.Run{}, err
	}
	if err != nil {
		rec.Err = err.Error()
	}

	var entries []history.Entry
	if p != nil {
		rec.Unchanged = p.Unchanged
		rec.Skipped = len(p.Skipped)
		entries = wouldDo(p)
		// The counts are what the run WOULD have done. Written into the same
		// fields a real run uses, because a person reading the history wants to
		// compare like with like, and a separate set of "proposed" columns would
		// mean every reader of that table learning which pair to look at.
		//
		// What keeps the two apart is the entry list: every line of a report
		// carries the "would" kinds below, and nothing else in the app produces
		// them. A report can therefore never be mistaken for work that happened,
		// which a bare set of numbers absolutely could.
		for _, a := range p.Actions {
			switch a.Kind {
			case plan.Copy:
				rec.Copied++
			case plan.Move:
				rec.Moved++
			case plan.Delete:
				rec.Trashed++
			case plan.Conflict:
				rec.Conflicts++
			}
		}
	}

	if r.hist != nil {
		if hErr := r.hist.Record(ctx, rec, entries); hErr != nil {
			r.log("could not write the report record for %s: %v", name, hErr)
		}
	}
	r.announce(ctx, rec, apply.Result{})
	finished := Event{Job: name, Phase: "finished", Run: &rec}
	if err != nil {
		finished.Error = err.Error()
	}
	r.publish(finished)
	return rec, err
}

// wouldDo turns a plan into the same per-file lines a real run writes, marked
// as proposals.
//
// The prefix is what stops a report being read as work. Every kind here is
// "would-", and nothing that actually moves a file ever produces one, so a
// history row and its lines can only ever say one of the two things.
func wouldDo(p *plan.Plan) []history.Entry {
	if p == nil {
		return nil
	}
	out := make([]history.Entry, 0, len(p.Actions)+len(p.Skipped))
	for _, a := range p.Actions {
		out = append(out, history.Entry{
			Kind: "would-" + a.Kind.String(),
			Side: a.Dst.String(),
			Path: a.Path,
			Note: a.Reason.String(),
		})
	}
	for _, s := range p.Skipped {
		out = append(out, history.Entry{Kind: "skip", Path: s.Path, Note: s.Reason.String()})
	}
	return out
}
