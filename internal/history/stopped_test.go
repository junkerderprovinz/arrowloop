package history

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// Somebody who stops a run has not seen it fail, and the job has not done its
// work either, so a stopped run counts as neither.
func TestAStoppedRunIsNeitherASuccessNorAFailure(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	worked := time.Date(2026, 3, 1, 9, 0, 0, 0, time.Local)
	stopped := worked.Add(time.Hour)
	if err := db.Record(ctx, Run{Job: "test", Started: worked, Finished: worked.Add(time.Minute), Copied: 3}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := db.Record(ctx, Run{Job: "test", Started: stopped, Finished: stopped.Add(time.Minute), Copied: 1, Stopped: true}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}

	all, err := db.Recent(ctx, "test", ShowAll, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(all) != 2 || !all[0].Stopped || all[1].Stopped {
		t.Fatalf("the runs read back as %+v, want the newer one stopped", all)
	}
	if all[0].Failed() {
		t.Error("the stopped run reads as failed")
	}
	for _, show := range []Show{ShowSucceeded, ShowUsual, ShowFailed} {
		runs, err := db.Recent(ctx, "test", show, 10)
		if err != nil {
			t.Fatalf("recent %q: %v", show, err)
		}
		for _, r := range runs {
			if r.Stopped {
				t.Errorf("the %q runs list the stopped one", show)
			}
		}
	}

	last, ok, err := db.LastSuccess(ctx, "test")
	if err != nil || !ok {
		t.Fatalf("last success: %v %v", ok, err)
	}
	if !last.Equal(worked.Add(time.Minute)) {
		t.Errorf("the last success is %v, want the run before the stopped one", last)
	}
	if fails, _, err := db.FailuresSince(ctx, "test", time.Time{}); err != nil || fails != 0 {
		t.Errorf("counted %d failures (%v), want none", fails, err)
	}
	latest, err := db.Latest(ctx, time.Time{})
	if err != nil || len(latest) != 1 || !latest[0].Stopped {
		t.Errorf("the latest run reads back as %+v (%v), want the stopped one", latest, err)
	}
	after, err := db.After(ctx, 0, 10)
	if err != nil || len(after) != 2 || !after[1].Stopped {
		t.Errorf("the runs after the start read back as %+v (%v), want the newer one stopped", after, err)
	}
}
