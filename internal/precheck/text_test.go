package precheck

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// internal/failure reads the side and both figures back out of this sentence
// to say it in the reader's language, so its words are held here.
func TestTheSpaceFindingKeepsTheWordsTheInterfaceReads(t *testing.T) {
	var r Report
	r.noteSide("notEnoughSpace", plan.Right, true, "needed", "31649416331", "free", "16384")
	want := "the right side reports 16384 bytes free and this job would write at least 31649416331"
	if got := r.Findings[0].Text; got != want {
		t.Errorf("the space finding reads %q, want %q", got, want)
	}
}
