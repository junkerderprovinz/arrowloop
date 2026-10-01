package daemon

import (
	"context"
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
