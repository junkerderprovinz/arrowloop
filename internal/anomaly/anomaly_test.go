package anomaly

import (
	"path/filepath"
	"testing"
	"time"
)

func everyJob(string) bool { return true }

func TestFindingsSurviveARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "anomalies.json")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	f, change := s.Raise(Finding{Job: "fotos", Kind: Change, Count: 30, Known: 40, Mark: "abc"})
	if change != New || !f.Held || f.Severity != "critical" {
		t.Fatalf("a first mass change raised %v, held %v, %s; want a new critical finding that holds", change, f.Held, f.Severity)
	}

	again, err := Open(path)
	if err != nil {
		t.Fatalf("open again: %v", err)
	}
	if got, ok := again.Holding("fotos"); !ok || got.ID != f.ID {
		t.Errorf("after a restart the job is held %v by %q, want it held by %q", ok, got.ID, f.ID)
	}
}

func TestAPermissionCoversOnlyTheSameChange(t *testing.T) {
	s, _ := Open("")
	f, _ := s.Raise(Finding{Job: "fotos", Kind: Delete, Mark: "abc"})
	if marks, err := s.Allow(f.ID); err != nil || len(marks) != 1 || marks[0] != "abc" {
		t.Fatalf("allowing gave %v (%v), want the one mark", marks, err)
	}
	if same, _ := s.Raise(Finding{Job: "fotos", Kind: Delete, Mark: "abc"}); !same.Allowed {
		t.Error("the same change lost its permission when it was confirmed")
	}
	if grown, _ := s.Raise(Finding{Job: "fotos", Kind: Delete, Mark: "xyz"}); grown.Allowed {
		t.Error("a different change inherited the permission")
	}
}

func TestAHeldJobCannotBeAcknowledgedAway(t *testing.T) {
	s, _ := Open("")
	f, _ := s.Raise(Finding{Job: "fotos", Kind: Empty})
	if err := s.Acknowledge(f.ID); err == nil {
		t.Error("a finding that holds its job was acknowledged, leaving the job held with nothing to show for it")
	}
}

func TestClosedFindingsLeaveAfterAMonthAndWithTheirJob(t *testing.T) {
	s, _ := Open("")
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	s.Raise(Finding{Job: "fotos", Kind: Failing})
	s.Raise(Finding{Job: "musik", Kind: Failing})
	s.Settle("fotos", Resolved, Failing)

	now = now.Add(Kept - time.Hour)
	if _, closed := s.List(everyJob); len(closed) != 1 {
		t.Fatalf("got %d closed findings inside the month, want 1", len(closed))
	}
	now = now.Add(2 * time.Hour)
	open, closed := s.List(func(job string) bool { return job != "musik" })
	if len(open) != 0 || len(closed) != 0 {
		t.Errorf("got %d open and %d closed, want the old one and the removed job's gone", len(open), len(closed))
	}
}
