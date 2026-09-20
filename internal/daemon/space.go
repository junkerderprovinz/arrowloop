package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

// ErrNotEnoughSpace stops a run that would not fit. It is its own error because
// a run refused before it started left everything as it was.
var ErrNotEnoughSpace = errors.New("not enough room on the destination")

// roomFor refuses an automatic run whose plan would not fit. A full destination
// leaves a partial file behind and a state database that disagrees with the
// disk. A job started by hand is not checked: the estimate can be wrong either
// way, and a person will read the error.
func (r *Runner) roomFor(ctx context.Context, j job.Job) error {
	return refusalFrom(precheck.Check(ctx, j, precheck.Opts{}))
}

// refusalFrom decides which of a report's findings stops a run: only the space
// finding. The run reports an unreachable side better itself, and creates a
// side that does not exist yet, so refusing over those would fail the first run
// of every new job.
func refusalFrom(report precheck.Report) error {
	if report.OK {
		return nil
	}
	var tight []string
	for _, f := range report.Findings {
		if f.Code == "notEnoughSpace" {
			tight = append(tight, f.Text)
		}
	}
	if len(tight) == 0 {
		return nil
	}
	return fmt.Errorf("%w: %s", ErrNotEnoughSpace, strings.Join(tight, "; "))
}
