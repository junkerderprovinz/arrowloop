package daemon

import (
	"errors"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

// Which findings stop a scheduled run, and which do not.
//
// This is an in-package test on purpose. The decision it covers is genuinely
// unexported, and the alternative was worse: giving the runner an injectable
// checker so an outside test could hand it a full disk would put a seam in
// production code that exists for the test alone.
//
// What is NOT covered here, said plainly rather than left to be assumed: that
// the scheduled path actually calls this. A disk with four bytes left is a real
// state and there is no portable way to stand in one, so the wiring is held by
// the one call site in RunAutomatically and by reading it, not by a test.
// internal/precheck tests the arithmetic that produces the finding.

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
	// The side's own words come through, or the log line says "not enough room"
	// and nothing about which side or how much.
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
	// The case that would have made this feature unusable. A brand new job has
	// no destination folder yet and no state database, and precheck says so.
	// Refusing on those would fail the first run of every job somebody creates,
	// which is the worst possible first impression: the switch would be off
	// within a day and the space check with it.
	for _, code := range []string{"sideNew", "stateNew", "spaceUnknown", "sideNotWritten"} {
		if err := refusalFrom(report(code)); err != nil {
			t.Errorf("a report carrying only %q refused the run: %v", code, err)
		}
	}
}

func TestAnUnreachableSideIsLeftToTheRunItself(t *testing.T) {
	// Not indifference. The run turns this into a real error carrying the
	// backend's own words about what went wrong, which is more use than a
	// second, vaguer refusal written here.
	for _, code := range []string{"sideUnreachable", "volumeMissing", "sideMissing", "planFailed"} {
		if err := refusalFrom(report(code)); err != nil {
			t.Errorf("a report carrying only %q refused the run here: %v", code, err)
		}
	}
}

func TestSpaceStillStopsItAmongOtherFindings(t *testing.T) {
	// The realistic shape: a report rarely carries one finding. A filter that
	// looked only at the first would pass this.
	err := refusalFrom(report("stateNew", "spaceUnknown", "notEnoughSpace", "sideNew"))
	if !errors.Is(err, ErrNotEnoughSpace) {
		t.Errorf("space did not stop the run when other findings were present: %v", err)
	}
}
