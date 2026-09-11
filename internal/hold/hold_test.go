package hold

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// at builds a store whose clock is one this test moves by hand. A real clock
// would make the staleness test either slow or flaky, and both are worse than
// a field.
func at(start time.Time) (*Store, *time.Time) {
	now := start
	s := New()
	s.now = func() time.Time { return now }
	return s, &now
}

func TestNothingReportedHoldsNothing(t *testing.T) {
	if err := New().Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("a store nothing was reported to held a run: %v", err)
	}
}

func TestAReportedReasonHoldsARun(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("this phone is on battery")

	err := s.Condition()(context.Background(), job.Job{})
	if err == nil {
		t.Fatal("a reported reason did not hold the run")
	}
	// The reporter's words, unaltered: the log is read by somebody who needs to
	// know WHICH condition stopped it, and a house sentence would lose that.
	if err.Error() != "this phone is on battery" {
		t.Fatalf("the reason was rewritten: %q", err.Error())
	}
}

func TestAnEmptyReportClearsTheHold(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("this phone is on battery")
	s.Report("")

	if err := s.Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("the hold survived being cleared: %v", err)
	}
}

// The one that matters. An app that is killed stops reporting, and a hold that
// never expires would stop every scheduled run from then on - on a phone that
// has been on the charger since.
func TestAStaleReportStopsHolding(t *testing.T) {
	s, now := at(time.Now())
	s.Report("this phone is on battery")

	*now = now.Add(Stale - time.Minute)
	if err := s.Condition()(context.Background(), job.Job{}); err == nil {
		t.Fatal("the hold expired early, while the report was still fresh")
	}

	*now = now.Add(2 * time.Minute)
	if err := s.Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("a report older than %v still held a run: %v", Stale, err)
	}
}

func TestTheStateSaysWhatTheConditionDoes(t *testing.T) {
	s, now := at(time.Now())
	s.Report("this connection is metered")

	if got := s.State(); got.Reason != "this connection is metered" || got.Stale {
		t.Fatalf("a fresh report read back wrong: %+v", got)
	}

	*now = now.Add(Stale + time.Second)
	if got := s.State(); !got.Stale {
		t.Fatalf("a state a run would ignore did not say it was stale: %+v", got)
	}
}
