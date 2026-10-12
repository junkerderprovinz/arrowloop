package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestEveryJobKeepsItsLatestRunBesideABusyOne(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	morning := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)

	record := func(r history.Run) {
		t.Helper()
		if err := db.Record(ctx, r, nil); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	yesterday := morning.Add(-time.Hour)
	record(history.Run{Job: "watcher", Started: yesterday, Finished: yesterday})
	daily := morning.Add(8 * time.Hour)
	record(history.Run{Job: "daily", Started: daily, Finished: daily.Add(time.Second), Copied: 3})
	for i := 1; i <= 60; i++ {
		at := daily.Add(time.Duration(i) * time.Minute)
		record(history.Run{Job: "watcher", Started: at, Finished: at, Copied: 1})
	}

	latest, err := db.Latest(ctx, morning)
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if len(latest) != 2 {
		t.Fatalf("expected one row for each of the two jobs, got %d", len(latest))
	}
	watcher, day := latest[0], latest[1]
	if watcher.Job != "watcher" || day.Job != "daily" {
		t.Fatalf("expected the newest run first, got %s then %s", watcher.Job, day.Job)
	}
	if !watcher.Started.Equal(daily.Add(60 * time.Minute)) {
		t.Errorf("watcher's row is the run from %v, not its latest", watcher.Started)
	}
	if watcher.Since != 60 {
		t.Errorf("watcher ran 60 times since the morning, counted %d", watcher.Since)
	}
	if day.Since != 1 || day.Copied != 3 {
		t.Errorf("daily = %+v, want its one run with three copies", day)
	}
}

func TestEachJobGetsOnlyItsOwnNewestRuns(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	start := time.Date(2026, 9, 28, 8, 0, 0, 0, time.UTC)

	for i := 0; i < 20; i++ {
		at := start.Add(time.Duration(i) * time.Minute)
		if err := db.Record(ctx, history.Run{Job: "watcher", Started: at, Finished: at, Copied: i}, nil); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	if err := db.Record(ctx, history.Run{Job: "daily", Started: start, Finished: start, Err: "boom"}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := db.Record(ctx, history.Run{Job: "removed", Started: start, Finished: start}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}

	got, err := db.EachRecent(ctx, []string{"watcher", "daily", "never ran"}, 14)
	if err != nil {
		t.Fatalf("each recent: %v", err)
	}
	if len(got["watcher"]) != 14 {
		t.Fatalf("watcher has %d runs, want the newest 14", len(got["watcher"]))
	}
	if got["watcher"][0].Copied != 19 || got["watcher"][13].Copied != 6 {
		t.Errorf("watcher's runs run from %d to %d, want 19 down to 6", got["watcher"][0].Copied, got["watcher"][13].Copied)
	}
	if len(got["daily"]) != 1 || got["daily"][0].Err != "boom" {
		t.Errorf("daily = %+v, want its one failed run", got["daily"])
	}
	if len(got["removed"]) != 0 || len(got["never ran"]) != 0 {
		t.Errorf("got runs of jobs not asked for or never run: %v %v", got["removed"], got["never ran"])
	}
}
