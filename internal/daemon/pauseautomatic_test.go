package daemon

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

func pauseAutomatic(r *Runner) {
	next := edited(r.config())
	next.PauseAutomatic = true
	r.Reload(next)
}

func TestPausedAutomaticRunsLeaveADueJobWaiting(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "nightly", Schedule: "0 3 * * *"})
	now := time.Now()
	if due := r.Due(context.Background(), now); len(due) != 1 {
		t.Fatalf("a job that never ran is not due: %v", due)
	}
	pauseAutomatic(r)
	if due := r.Due(context.Background(), now); len(due) != 0 {
		t.Errorf("due while automatic runs are paused: %v", due)
	}
}

func TestPausedAutomaticRunsTryNoFailedJobAgain(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "nightly", Schedule: "0 3 * * *"})
	failed := time.Now().Add(-time.Hour)
	if err := r.hist.Record(context.Background(), history.Run{Job: "nightly", Started: failed, Finished: failed, Err: "the remote refused the connection"}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	if again := r.Retrying(context.Background(), time.Now()); len(again) != 1 {
		t.Fatalf("the failed job is not tried again: %v", again)
	}
	pauseAutomatic(r)
	if again := r.Retrying(context.Background(), time.Now()); len(again) != 0 {
		t.Errorf("tried again while automatic runs are paused: %v", again)
	}
}

func TestARequestIsRefusedWhileAutomaticRunsArePaused(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox"})
	pauseAutomatic(r)
	if _, err := r.Request("inbox", "the downloader"); !errors.Is(err, ErrPaused) {
		t.Fatalf("a request: %v, want ErrPaused", err)
	}
}

func TestPausedAutomaticRunsCatchNothingUp(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	d.missesItsDrive(t)
	d.plug(true)
	pauseAutomatic(d.r)

	d.r.catchUp(context.Background())
	if n := len(runsOf(t, d.r, "x")); n != 1 {
		t.Errorf("the job ran when its drive came back, %d runs", n)
	}
}

func TestPausedAutomaticRunsSkipTheRunAtStart(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox", RunAtStart: true})
	pauseAutomatic(r)
	r.runAtStart(context.Background())
	time.Sleep(time.Second)
	if n := recordedRuns(t, r, "inbox"); n != 0 {
		t.Errorf("the job ran at start %d times", n)
	}
}

func TestAJobStartedByHandRunsWhileAutomaticRunsArePaused(t *testing.T) {
	r := requestRunner(t, job.Job{Name: "inbox"})
	pauseAutomatic(r)
	if _, err := r.Run(context.Background(), "inbox"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if n := recordedRuns(t, r, "inbox"); n != 1 {
		t.Errorf("%d runs recorded, want the one started by hand", n)
	}
}
