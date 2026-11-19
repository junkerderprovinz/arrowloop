package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// withIDs gives the small configuration's jobs the ids Load would.
func withIDs(t *testing.T) (*Runner, map[string]string) {
	t.Helper()
	cfg := smallConfig(t)
	ids := map[string]string{"slow": "aaaaaaaaaaaa", "quick": "bbbbbbbbbbbb"}
	for i := range cfg.Jobs {
		cfg.Jobs[i].ID = ids[cfg.Jobs[i].Name]
	}
	return smallRunner(t, cfg), ids
}

// renamed reloads r with the job called from renamed to.
func renamed(r *Runner, from, to string) {
	next := edited(r.Config())
	for i := range next.Jobs {
		if next.Jobs[i].Name == from {
			next.Jobs[i].Name = to
		}
	}
	r.Reload(next)
}

func TestARunGoesOnThroughARenameOfItsJob(t *testing.T) {
	r, ids := withIDs(t)
	events, unsubscribe := r.Subscribe()
	defer unsubscribe()
	// Read as they come, since a full stream drops what it cannot hand over.
	finished := make(chan Event, 1)
	go func() {
		for ev := range events {
			if ev.Phase == "finished" {
				finished <- ev
				return
			}
		}
	}()

	done := make(chan history.Run, 1)
	go func() {
		rec, _ := r.Run(context.Background(), "slow")
		done <- rec
	}()
	waitForClaim(t, r, "slow")
	renamed(r, "slow", "sluggish")

	if !r.Running()["sluggish"] {
		t.Fatal("the rename stopped the run")
	}
	if !r.Cancel("sluggish") {
		t.Fatal("the run cannot be stopped by the job's new name")
	}
	var rec history.Run
	select {
	case rec = <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("the run never ended")
	}
	if rec.Job != "sluggish" || rec.JobID != ids["slow"] {
		t.Errorf("the run was recorded as %q, %q; want the new name and the id it always had", rec.Job, rec.JobID)
	}
	if runs := runsOf(t, r, ids["slow"]); len(runs) != 1 || runs[0].Job != "sluggish" {
		t.Errorf("the log of the job holds %+v, want the one run under its new name", runs)
	}

	select {
	case ev := <-finished:
		if ev.Job != "sluggish" || ev.JobID != ids["slow"] {
			t.Errorf("the run's end went out as %q, %q; want the new name and the id", ev.Job, ev.JobID)
		}
	case <-time.After(5 * time.Second):
		t.Error("the run's end never went out")
	}
}

func TestARunWaitingForItsTurnRunsUnderItsNewName(t *testing.T) {
	r, ids := withIDs(t)
	startSlow(t, r)

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "quick")
		done <- err
	}()
	waitForClaim(t, r, "quick")
	renamed(r, "quick", "speedy")
	r.Cancel("slow")

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("the waiting run ended with %v, want it to run", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the waiting run never had its turn")
	}
	if runs := runsOf(t, r, ids["quick"]); len(runs) != 1 || runs[0].Job != "speedy" {
		t.Errorf("the log of the job holds %+v, want its run under the new name", runs)
	}
}

func TestARenamedJobKeepsWhatItLearned(t *testing.T) {
	r, ids := withIDs(t)
	for range 3 {
		if _, err := r.Run(context.Background(), "quick"); err != nil {
			t.Fatal(err)
		}
	}
	renamed(r, "quick", "speedy")
	for _, l := range r.Learning(context.Background()) {
		if l.JobID != ids["quick"] {
			continue
		}
		if l.Job != "speedy" || l.Runs != 3 {
			t.Errorf("after the rename the job has learned %+v, want its three runs under the new name", l)
		}
		return
	}
	t.Error("the renamed job is missing from what was learned")
}
