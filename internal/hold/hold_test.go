package hold

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// at builds a store whose clock the test moves by hand.
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
	s.Report("this phone is on battery", false)

	err := s.Condition()(context.Background(), job.Job{})
	if err == nil {
		t.Fatal("a reported reason did not hold the run")
	}
	// The log needs the reporter's words to say which condition stopped it.
	if err.Error() != "this phone is on battery" {
		t.Fatalf("the reason was rewritten: %q", err.Error())
	}
}

func TestAnEmptyReportClearsTheHold(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("this phone is on battery", false)
	s.Report("", false)

	if err := s.Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("the hold survived being cleared: %v", err)
	}
}

// A killed app stops reporting, so its last hold must expire.
func TestAStaleReportStopsHolding(t *testing.T) {
	s, now := at(time.Now())
	s.Report("this phone is on battery", false)

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
	s.Report("this connection is metered", false)

	if got := s.State(); got.Reason != "this connection is metered" || got.Stale {
		t.Fatalf("a fresh report read back wrong: %+v", got)
	}

	*now = now.Add(Stale + time.Second)
	if got := s.State(); !got.Stale {
		t.Fatalf("a state a run would ignore did not say it was stale: %+v", got)
	}
}

// A phone without a network holds the jobs that reach a server, and only them.
func TestNoNetworkHoldsOnlyJobsThatNeedOne(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("", true)

	remote := job.Job{Left: t.TempDir(), Right: "cloud:photos"}
	if err := s.Condition()(context.Background(), remote); err == nil {
		t.Error("a job with a server side ran with no network, and its failure uses up a retry")
	}
	local := job.Job{Left: t.TempDir(), Right: t.TempDir()}
	if err := s.Condition()(context.Background(), local); err != nil {
		t.Errorf("a job between two folders on the phone was held for want of a network: %v", err)
	}

	s.Report("", false)
	if err := s.Condition()(context.Background(), remote); err != nil {
		t.Errorf("the network came back and the job was still held: %v", err)
	}
}
