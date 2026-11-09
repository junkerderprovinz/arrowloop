package daemon

import (
	"context"
	"fmt"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// leftAgain names the paths this run left for later that the job's previous
// run had left for later too, or returns "" when there are none. Leaving a file
// once is routine, since the next run tries again; leaving it twice means the
// retry did not help and somebody has to look.
func (r *Runner) leftAgain(ctx context.Context, name string, skipped []plan.Skip) string {
	if r.hist == nil || len(skipped) == 0 {
		return ""
	}
	before, err := r.hist.LeftLastTime(context.WithoutCancel(ctx), name)
	if err != nil {
		r.log("%s: could not read what the last run left for later: %v", name, err)
		return ""
	}
	var again []plan.Skip
	for _, s := range skipped {
		if before[s.Path] {
			again = append(again, s)
		}
	}
	if len(again) == 0 {
		return ""
	}
	// The run's log holds the whole list, so the sentence names a few.
	var b strings.Builder
	b.WriteString("left for later in two runs in a row: ")
	for i, s := range again {
		if i == 3 {
			fmt.Fprintf(&b, "; and %d more", len(again)-i)
			break
		}
		if i > 0 {
			b.WriteString("; ")
		}
		fmt.Fprintf(&b, "%s (%s)", s.Path, s.Reason)
	}
	return b.String()
}
