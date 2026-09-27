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
