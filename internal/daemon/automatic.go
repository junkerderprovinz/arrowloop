package daemon

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// RunAutomatically is what the clock and the watcher call. Everything in it is
// a restraint on work nobody is watching; a person pressing the button has
// already decided, so Run does none of this.
func (r *Runner) RunAutomatically(ctx context.Context, name string) (history.Run, error) {
	j, ok := r.config().Find(name)
	if !ok {
		return history.Run{}, fmt.Errorf("no job called %q", name)
	}
	if cond := r.condition(); cond != nil {
		if err := cond(ctx, j); err != nil {
			return history.Run{}, fmt.Errorf("%w: %w", ErrHeldBack, err)
		}
	}
	// A drive in a drawer is remembered rather than logged as a failure, so
	// the interface can say it is waiting. A before command may be what
	// mounts it, so such a job finds out from the run.
	if j.Before == "" {
		if err := attached(j); err != nil {
			r.waiting.note(name, time.Now())
			return history.Run{}, fmt.Errorf("%w: %w", ErrVolumeMissing, err)
		}
	}
	r.waiting.clear(name)

	// The space check lists both sides, so it waits for the job's claim, and
	// a refusal is recorded like any failure so the retry policy sees it.
	rec, err := r.runAs(ctx, name, true, func(ctx context.Context, j job.Job, live *history.Live) (apply.Result, *plan.Plan, error) {
		if err := r.roomFor(ctx, j); err != nil {
			return apply.Result{}, nil, err
		}
		var only []string
		if j.ReportOnly {
			// An empty selection, not nil: nil means everything, while an
			// empty list plans in full, records the run and filters every
			// action away.
			only = []string{}
		}
		return r.execute(ctx, j, only, nil, nil, live)
	})
	if errors.Is(err, ErrVolumeMissing) {
		r.waiting.note(name, time.Now())
	}
	return rec, err
}
