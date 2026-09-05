package apply

import (
	"context"

	"github.com/junkerderprovinz/reeveroll/internal/plan"
)

// RunConflictPrefix executes only the first n steps of a conflict resolution.
//
// It exists so that a crash in the middle of the manoeuvre can be reproduced
// using the engine's own steps rather than by hand-building a tree and hoping
// it is the one a crash would leave. It is defined in a _test.go file, so it is
// compiled into tests only and is not part of what the package ships.
func RunConflictPrefix(ctx context.Context, ends Ends, act plan.Action, runID string, n int) error {
	steps, err := conflictSteps(ends, act, runID)
	if err != nil {
		return err
	}
	for i, s := range steps {
		if i >= n {
			break
		}
		if err := s.do(ctx); err != nil {
			return err
		}
	}
	return nil
}

// ConflictStepCount reports how many steps a resolution takes, so a test can
// cover every crash point without hard-coding the number.
func ConflictStepCount() int { return 3 }
