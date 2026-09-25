package apply

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

func TestTheLogSpellsAFileAsItsSideDoes(t *testing.T) {
	cases := []struct {
		act  plan.Action
		want string
	}{
		{plan.Action{Path: "garden plan.pdf", LeftNow: &scan.Entry{Path: "Garden plan.pdf"}}, "Garden plan.pdf"},
		{plan.Action{Path: "recipes.odt", RightNow: &scan.Entry{Path: "Recipes.odt"}}, "Recipes.odt"},
		{plan.Action{Path: "gone.txt"}, "gone.txt"},
	}
	for _, c := range cases {
		if got := spelled(c.act); got != c.want {
			t.Errorf("spelled(%q) = %q, want %q", c.act.Path, got, c.want)
		}
	}
}
