package daemon

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// smallConfig is two jobs over empty folders, one of them held up by a before
// command for a few seconds.
func smallConfig(t *testing.T) *job.Config {
	t.Helper()
	root := t.TempDir()
	pause := "sleep 5"
	if runtime.GOOS == "windows" {
		pause = "ping -n 6 127.0.0.1 > nul"
	}
	cfg := &job.Config{ParallelJobs: 1}
	for _, name := range []string{"slow", "quick"} {
		left := filepath.Join(root, name, "left")
		right := filepath.Join(root, name, "right")
		for _, d := range []string{left, right} {
			if err := os.MkdirAll(d, 0o755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
		}
		j := job.Job{Name: name, Left: left, Right: right, State: filepath.Join(root, name+".db")}
		if name == "slow" {
			j.Before = pause
		}
		cfg.Jobs = append(cfg.Jobs, j)
	}
	return cfg
}

func smallRunner(t *testing.T, cfg *job.Config) *Runner {
	t.Helper()
	hist, err := history.Open(context.Background(), filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	return New(cfg, hist, func(string, ...any) {})
}

// Somebody who adds a webhook in the interface expects the next failure to
// reach it, not the one after a restart.
func TestANotificationTargetAddedLaterIsUsed(t *testing.T) {
	var heard atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		heard.Add(1)
	}))
	defer srv.Close()

	cfg := smallConfig(t)
	r := smallRunner(t, cfg)

	next := *cfg
	next.Notify = job.Notify{Webhook: srv.URL, OnSuccess: true}
	r.Reload(&next)

	if _, err := r.Run(context.Background(), "quick"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if heard.Load() == 0 {
		t.Error("the webhook saved after start was never called")
	}
}

func TestMoreJobsAtOnceTakesEffectWithoutARestart(t *testing.T) {
	cfg := smallConfig(t)
	r := smallRunner(t, cfg)
	events, unsubscribe := r.Subscribe()
	defer unsubscribe()

	slowCtx, stopSlow := context.WithCancel(context.Background())
	slowDone := make(chan struct{})
	go func() {
		defer close(slowDone)
		r.Run(slowCtx, "slow")
	}()
	defer func() {
		stopSlow()
		<-slowDone
	}()
	for ev := range events {
		if ev.Job == "slow" && ev.Phase == "started" {
			break
		}
	}

	next := *cfg
	next.ParallelJobs = 2
	r.Reload(&next)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := r.Run(ctx, "quick"); err != nil {
		t.Fatalf("the second job waited for the first although two may run at once: %v", err)
	}
}

// startSlow runs the slow job until the test ends and returns once it holds
// the only run slot.
func startSlow(t *testing.T, r *Runner) {
	t.Helper()
	events, unsubscribe := r.Subscribe()
	defer unsubscribe()

	ctx, stop := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.Run(ctx, "slow")
	}()
	t.Cleanup(func() {
		stop()
		<-done
	})
	for ev := range events {
		if ev.Job == "slow" && ev.Phase == "started" {
			return
		}
	}
}

// waitForClaim returns once name has claimed its run and waits for a slot.
func waitForClaim(t *testing.T, r *Runner, name string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !r.Running()[name] {
		if time.Now().After(deadline) {
			t.Fatalf("%s never claimed its run", name)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// edited returns a copy of cfg whose job list can be changed without touching
// the one the runner holds.
func edited(cfg *job.Config) *job.Config {
	next := *cfg
	next.Jobs = append([]job.Job(nil), cfg.Jobs...)
	return &next
}

func runsOf(t *testing.T, r *Runner, name string) []history.Run {
	t.Helper()
	runs, err := r.hist.Recent(context.Background(), name, history.ShowAll, 10)
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}
	return runs
}

func TestAJobRemovedWhileWaitingForItsTurnDoesNotRun(t *testing.T) {
	cfg := smallConfig(t)
	r := smallRunner(t, cfg)
	startSlow(t, r)

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "quick")
		done <- err
	}()
	waitForClaim(t, r, "quick")

	next := edited(cfg)
	next.Jobs = next.Jobs[:1]
	r.Reload(next)

	select {
	case err := <-done:
		if err == nil {
			t.Error("the removed job ran")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the removed job still waits for its turn")
	}
	if runs := runsOf(t, r, "quick"); len(runs) != 0 {
		t.Errorf("the removed job left %d runs in the log", len(runs))
	}
}

func TestAJobPausedWhileWaitingForItsTurnDoesNotRunOnItsOwn(t *testing.T) {
	cfg := smallConfig(t)
	r := smallRunner(t, cfg)
	startSlow(t, r)

	done := make(chan error, 1)
	go func() {
		_, err := r.RunAutomatically(context.Background(), "quick")
		done <- err
	}()
	waitForClaim(t, r, "quick")

	next := edited(cfg)
	next.Jobs[1].Disabled = true
	r.Reload(next)
	r.Cancel("slow")

	select {
	case err := <-done:
		if !errors.Is(err, ErrWithdrawn) {
			t.Errorf("the paused job ended with %v, want ErrWithdrawn", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the paused job never gave up its turn")
	}
	if runs := runsOf(t, r, "quick"); len(runs) != 0 {
		t.Errorf("the paused job left %d runs in the log", len(runs))
	}
}

func TestAJobEditedWhileWaitingForItsTurnRunsAsEdited(t *testing.T) {
	cfg := smallConfig(t)
	r := smallRunner(t, cfg)
	startSlow(t, r)

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "quick")
		done <- err
	}()
	waitForClaim(t, r, "quick")

	moved := t.TempDir()
	if err := os.WriteFile(filepath.Join(moved, "neu.txt"), []byte("neu"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	next := edited(cfg)
	next.Jobs[1].Left = moved
	// A file written a moment ago is otherwise left until it settles.
	next.Jobs[1].QuietPeriod = "0s"
	r.Reload(next)
	r.Cancel("slow")

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("the edited job failed: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the edited job never ran")
	}
	if _, err := os.Stat(filepath.Join(cfg.Jobs[1].Right, "neu.txt")); err != nil {
		t.Errorf("the run used the job as it was before the edit: %v", err)
	}
}
