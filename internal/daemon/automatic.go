package daemon

import (
	"context"
	"fmt"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// RunAutomatically is what the clock and the watcher call.
//
// It exists to keep ONE distinction that a single Run method cannot carry: who
// asked. Everything in here is a restraint that applies to work nobody is
// watching and must not apply to a person pressing a button, because pressing
// the button IS the decision. A single entry point serving both is how the
// automatic behaviour leaks into the manual one, and the leak is silent: the
// button appears to work and quietly does nothing.
//
// It used to carry a third restraint, a job that ran on its schedule and
// applied nothing. That is gone: it answered a question nobody had, since the
// preview button already says what a run would do, on demand, without a setting
// that has to be remembered and switched back off. jdp: "Fuer was brauchen wir
// nur berichten, nie schreiben? das kann weg."
func (r *Runner) RunAutomatically(ctx context.Context, name string) (history.Run, error) {
	j, ok := r.config().Find(name)
	if !ok {
		return history.Run{}, fmt.Errorf("no job called %q", name)
	}
	// The conditions this machine puts on automatic work, asked before anything
	// is opened. A hand-started run never reaches here, which is the whole
	// point: somebody pressing the button on battery has decided.
	if cond := r.condition(); cond != nil {
		if err := cond(ctx, j); err != nil {
			return history.Run{}, fmt.Errorf("%w: %w", ErrHeldBack, err)
		}
	}
	// A drive in a drawer is not a failure and must not be logged as one. It is
	// remembered instead, so the interface can say what is actually true.
	if err := attached(j); err != nil {
		r.waiting.note(name, time.Now())
		return history.Run{}, fmt.Errorf("%w: %w", ErrVolumeMissing, err)
	}
	r.waiting.clear(name)

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
