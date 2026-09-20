package daemon

import (
	"context"
	"fmt"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
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
	// the interface can say it is waiting.
	if err := attached(j); err != nil {
		r.waiting.note(name, time.Now())
		return history.Run{}, fmt.Errorf("%w: %w", ErrVolumeMissing, err)
	}
	r.waiting.clear(name)

	if err := r.roomFor(ctx, j); err != nil {
		r.publish(Event{Job: name, Phase: "finished", Error: err.Error()})
		return history.Run{}, err
	}
	if j.ReportOnly {
		// An empty selection, not nil: nil means everything, while an empty
		// list plans in full, records the run and filters every action away.
		return r.RunOnly(ctx, name, []string{})
	}
	return r.Run(ctx, name)
}
