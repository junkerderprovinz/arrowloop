package daemon

import (
	"context"
	"fmt"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// leftAgain names the paths this run left for later that the job's previous
// run had left for later too, or returns "" when there are none. Leaving a file
// once is routine, since the next run tries again; leaving it twice means the
// retry did not help and somebody has to look. The same few come back with
// their reasons as codes, for an interface to word.
func (r *Runner) leftAgain(ctx context.Context, j job.Job, skipped []plan.Skip) (string, *failure.Twice) {
	if r.hist == nil || len(skipped) == 0 {
		return "", nil
	}
	before, err := r.hist.LeftLastTime(context.WithoutCancel(ctx), j.Key())
	if err != nil {
		r.log("%s: could not read what the last run left for later: %v", j.Name, err)
		return "", nil
	}
	var again []plan.Skip
	for _, s := range skipped {
		if before[s.Path] {
			again = append(again, s)
		}
	}
	if len(again) == 0 {
		return "", nil
	}
	// The run's log holds the whole list, so the sentence names a few.
	const named = 3
	twice := &failure.Twice{More: max(len(again)-named, 0)}
	var b strings.Builder
	b.WriteString("left for later in two runs in a row: ")
	for i, s := range again[:min(len(again), named)] {
		if i > 0 {
			b.WriteString("; ")
		}
		fmt.Fprintf(&b, "%s (%s)", s.Path, s.Reason)
		twice.Files = append(twice.Files, failure.Left{Path: s.Path, Code: s.Reason.Code, Vars: s.Reason.Vars, Text: s.Reason.Text})
	}
	if twice.More > 0 {
		fmt.Fprintf(&b, "; and %d more", twice.More)
	}
	return b.String(), twice
}
