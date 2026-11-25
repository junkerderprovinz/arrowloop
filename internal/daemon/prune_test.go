package daemon_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// A phone or a laptop is seldom up for a whole day, so waiting a day before
// the first trim would leave the log to grow on them.
func TestTheRunLogIsTrimmedAsTheSchedulerStarts(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string { return `{"jobs":[]}` })
	now := time.Now()
	recordRunAt(t, hist, now.Add(-200*24*time.Hour))
	recordRunAt(t, hist, now.Add(-time.Hour))

	r := daemon.New(cfg, hist, nil)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	served := make(chan error, 1)
	go func() { served <- r.Serve(ctx) }()

	waitFor(t, func() bool {
		runs, err := hist.Recent(context.Background(), "", history.ShowAll, 10)
		return err == nil && len(runs) == 1
	}, "the scheduler started and left a run older than ninety days in the log")

	stop()
	if err := <-served; err != nil {
		t.Fatalf("serve: %v", err)
	}
}

// Every save in the interface rebuilds the schedules, and a container saved
// more often than once a day must still have its log trimmed.
func TestTheRunLogIsTrimmedDailyThroughReloads(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
			return `{"jobs":[],"historyKeep":"48h"}`
		})
		r := daemon.New(cfg, hist, nil)
		ctx, stop := context.WithCancel(t.Context())
		defer stop()
		served := make(chan error, 1)
		go func() { served <- r.Serve(ctx) }()
		synctest.Wait()

		// Young enough to outlive the trim at start, too old for the next one.
		started := time.Now()
		recordRunAt(t, hist, started.Add(-47*time.Hour))
		recordRunAt(t, hist, started.Add(-time.Hour))

		for range 3 {
			time.Sleep(12 * time.Hour)
			r.Reload(cfg)
			synctest.Wait()
		}

		runs, err := hist.Recent(context.Background(), "", history.ShowAll, 10)
		if err != nil {
			t.Fatalf("history: %v", err)
		}
		if len(runs) != 1 {
			t.Errorf("%d runs left after a day and a half of saves every twelve hours, want the one younger than two days", len(runs))
		}

		stop()
		if err := <-served; err != nil {
			t.Fatalf("serve: %v", err)
		}
	})
}

func recordRunAt(t *testing.T, hist *history.DB, started time.Time) {
	t.Helper()
	run := history.Run{Job: "photos", Started: started, Finished: started.Add(time.Second)}
	if err := hist.Record(context.Background(), run, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
}

// The daemon's -keep-history flag stands in for historyKeep for as long as it
// runs, and zero keeps every record.
func TestAKeepSetOnTheRunnerOutranksTheConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name string
		keep time.Duration
		// old is the age of the older of two runs, past the given keep and
		// within the ninety days the configuration keeps, or past both.
		old  time.Duration
		left int
	}{
		{"shorter", 48 * time.Hour, 72 * time.Hour, 1},
		{"for ever", 0, 200 * 24 * time.Hour, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, hist, _, _ := fixture(t, func(dir, left, right string) string { return `{"jobs":[]}` })
			now := time.Now()
			recordRunAt(t, hist, now.Add(-tc.old))
			recordRunAt(t, hist, now.Add(-time.Hour))

			var mu sync.Mutex
			scheduled := false
			r := daemon.New(cfg, hist, func(format string, args ...any) {
				mu.Lock()
				defer mu.Unlock()
				scheduled = scheduled || strings.Contains(format, "nothing will run on its own")
			})
			r.SetHistoryKeep(tc.keep)
			ctx, stop := context.WithCancel(context.Background())
			defer stop()
			served := make(chan error, 1)
			go func() { served <- r.Serve(ctx) }()
			// The schedules are built after the trim at start.
			waitFor(t, func() bool {
				mu.Lock()
				defer mu.Unlock()
				return scheduled
			}, "the scheduler never built its schedules")
			stop()
			if err := <-served; err != nil {
				t.Fatalf("serve: %v", err)
			}

			runs, err := hist.Recent(context.Background(), "", history.ShowAll, 10)
			if err != nil {
				t.Fatalf("history: %v", err)
			}
			if len(runs) != tc.left {
				t.Errorf("%d runs left, want %d", len(runs), tc.left)
			}
		})
	}
}
