package daemon

import (
	"errors"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

// That the scheduled path reaches refusalFrom has no test, since a full disk
// cannot be staged portably; internal/precheck tests the arithmetic.

func report(codes ...string) precheck.Report {
	r := precheck.Report{}
	for _, c := range codes {
		r.Findings = append(r.Findings, precheck.Finding{Code: c, Text: c + " happened", Fatal: true})
	}
	r.OK = len(codes) == 0
	return r
}

func TestARunIsRefusedWhenItWouldNotFit(t *testing.T) {
	err := refusalFrom(report("notEnoughSpace"))
	if err == nil {
		t.Fatal("a run that would not fit was allowed to start")
	}
	if !errors.Is(err, ErrNotEnoughSpace) {
		t.Errorf("the refusal is not matchable as one: %v", err)
	}
	// The log has to say which side and how much.
	if err.Error() == ErrNotEnoughSpace.Error() {
		t.Error("the refusal carries none of the report's own words")
	}
}

func TestAHealthyReportRefusesNothing(t *testing.T) {
	if err := refusalFrom(report()); err != nil {
		t.Errorf("a healthy job was refused: %v", err)
	}
}

func TestTheFirstRunOfANewJobIsNotRefused(t *testing.T) {
	// A new job has no destination folder and no state database yet.
	for _, code := range []string{"sideNew", "stateNew", "spaceUnknown", "sideNotWritten"} {
		if err := refusalFrom(report(code)); err != nil {
			t.Errorf("a report carrying only %q refused the run: %v", code, err)
		}
	}
}

func TestAnUnreachableSideIsLeftToTheRunItself(t *testing.T) {
	// The run reports these in the backend's own words.
	for _, code := range []string{"sideUnreachable", "volumeMissing", "sideMissing", "planFailed"} {
		if err := refusalFrom(report(code)); err != nil {
			t.Errorf("a report carrying only %q refused the run here: %v", code, err)
		}
	}
}

func TestSpaceStillStopsItAmongOtherFindings(t *testing.T) {
	err := refusalFrom(report("stateNew", "spaceUnknown", "notEnoughSpace", "sideNew"))
	if !errors.Is(err, ErrNotEnoughSpace) {
		t.Errorf("space did not stop the run when other findings were present: %v", err)
	}
}
