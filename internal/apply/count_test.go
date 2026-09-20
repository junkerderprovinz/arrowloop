package apply

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// The progress total has to be what the run will report, and a move reports
// twice.
func TestAMoveCountsAsTheTwoStepsItReports(t *testing.T) {
	cases := []struct {
		name string
		p    plan.Plan
		want int
	}{
		{
			name: "a copy is one",
			p:    plan.Plan{Actions: []plan.Action{{Kind: plan.Copy}}},
			want: 1,
		},
		{
			name: "a relocate is two: the copy, then the source going",
			p:    plan.Plan{Actions: []plan.Action{{Kind: plan.Relocate}}},
			want: 2,
		},
		{
			name: "a delete is one",
			p:    plan.Plan{Actions: []plan.Action{{Kind: plan.Delete}}},
			want: 1,
		},
		{
			name: "an agreed file is one, the same as any other line",
			p:    plan.Plan{Agreed: []plan.Action{{Kind: plan.Copy}}},
			want: 1,
		},
		{
			name: "mixed, which is what a real move job looks like",
			p: plan.Plan{
				Actions: []plan.Action{
					{Kind: plan.Relocate},
					{Kind: plan.Relocate},
					{Kind: plan.Copy},
				},
				Agreed: []plan.Action{{Kind: plan.Copy}},
			},
			want: 6,
		},
		{
			// A folder made or removed is a step; a folder merely recorded is
			// not, and neither is one with nowhere to be made.
			name: "folders count only where something happens to them",
			p: plan.Plan{
				Dirs: []plan.DirAction{
					{Kind: plan.MakeDir, DstPath: "neu"},
					{Kind: plan.RecordDir, DstPath: "schon da"},
					{Kind: plan.MakeDir},
				},
			},
			want: 1,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := countWork(&c.p); got != c.want {
				t.Errorf("countWork = %d, want %d", got, c.want)
			}
		})
	}
}
