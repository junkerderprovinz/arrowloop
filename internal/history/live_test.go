package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestARunShowsInTheLogWhileItGoes(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	start := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	live := db.Begin("photos", start)
	live.Add(history.Entry{Kind: "copy", Side: "right", Path: "a.jpg", Size: 10})
	live.Add(history.Entry{Kind: "mkdir", Side: "right", Path: "b.jpg"})

	got, err := db.Log(ctx, history.Filter{Job: "photos"})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(got) != 2 || got[0].Path != "b.jpg" || got[1].Path != "a.jpg" {
		t.Fatalf("the log of a running run reads %+v, want b.jpg then a.jpg", got)
	}
	if got[0].Run >= 0 {
		t.Errorf("a running run has id %d, which a stored run could also have", got[0].Run)
	}

	runs, err := db.Following(ctx, "photos", history.ShowAll, time.Time{}, time.Time{}, 10)
	if err != nil {
		t.Fatalf("following: %v", err)
	}
	if len(runs) != 1 || !runs[0].Running || runs[0].Copied != 1 {
		t.Fatalf("the runs going read %+v, want one running with one copy", runs)
	}
	stored, err := db.Recent(ctx, "photos", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(stored) != 0 {
		t.Errorf("Recent lists %d runs, and a run with no end would read as the last one", len(stored))
	}
}

// Once recorded, the run reads exactly as it did while it went, from the
// table and only once.
func TestARecordedRunReplacesItsLiveLines(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	start := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	live := db.Begin("photos", start)
	live.Add(history.Entry{Kind: "copy", Side: "right", Path: "a.jpg", Note: "replaced", Size: 10})
	live.Add(history.Entry{Kind: "trash", Side: "left", Path: "c.jpg", Note: "bin"})
	before, err := db.Log(ctx, history.Filter{})
	if err != nil {
		t.Fatalf("log: %v", err)
	}

	if err := live.Record(ctx, history.Run{Job: "photos", Started: start, Finished: start.Add(time.Second), Copied: 1, Trashed: 1}); err != nil {
		t.Fatalf("record: %v", err)
	}
	after, err := db.Log(ctx, history.Filter{})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("the log had %d lines while the run went and %d after", len(before), len(after))
	}
	for i := range after {
		if after[i].Entry != before[i].Entry || !after[i].When.Equal(before[i].When) || after[i].Seq != before[i].Seq {
			t.Errorf("line %d read %+v while the run went and %+v after", i, before[i], after[i])
		}
		if after[i].Run <= 0 {
			t.Errorf("line %d still belongs to run %d after the record", i, after[i].Run)
		}
	}
	if got, _ := db.Entries(ctx, before[0].Run); len(got) != 0 {
		t.Errorf("the finished run is still readable by its running id: %+v", got)
	}
}

func TestTheLiveLinesAreSearchedLikeTheStoredOnes(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	start := time.Now()
	if err := db.Record(ctx, history.Run{Job: "photos", Started: start.Add(-time.Hour), Finished: start.Add(-time.Hour)}, []history.Entry{
		{Kind: "copy", Side: "right", Path: "Urlaub/old.jpg"},
	}); err != nil {
		t.Fatalf("record: %v", err)
	}
	live := db.Begin("photos", start)
	live.Add(history.Entry{Kind: "copy", Side: "right", Path: "Urlaub/new.jpg"})
	live.Add(history.Entry{Kind: "trash", Side: "right", Path: "Urlaub/gone.jpg"})
	live.Add(history.Entry{Kind: "copy", Side: "right", Path: "Arbeit/x.txt"})

	// SQLite's LIKE folds only ASCII, so "URLAUB" finds both runs' lines.
	got, err := db.Log(ctx, history.Filter{Contains: "URLAUB", Kinds: []string{"copy"}, Limit: 10})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(got) != 2 || got[0].Path != "Urlaub/new.jpg" || got[1].Path != "Urlaub/old.jpg" {
		t.Fatalf("the search found %+v, want the running copy and then the stored one", got)
	}

	got, err = db.Log(ctx, history.Filter{Limit: 2})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(got) != 2 || got[0].Path != "Arbeit/x.txt" || got[1].Path != "Urlaub/gone.jpg" {
		t.Errorf("a page of two reads %+v, want the two newest lines of the running run", got)
	}
}

func TestADroppedRunLeavesNothing(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	live := db.Begin("photos", time.Now())
	live.Add(history.Entry{Kind: "copy", Path: "a.jpg"})
	live.Drop()

	runs, err := db.Following(ctx, "", history.ShowAll, time.Time{}, time.Time{}, 10)
	if err != nil {
		t.Fatalf("following: %v", err)
	}
	touches, err := db.Log(ctx, history.Filter{})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(runs) != 0 || len(touches) != 0 {
		t.Errorf("a dropped run left %d runs and %d lines behind", len(runs), len(touches))
	}
}

// A run that has only copied is not a failure, and one that has done nothing
// yet is not a change.
func TestTheRunFiltersApplyToARunningRun(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	start := time.Now()
	busy := db.Begin("busy", start)
	busy.Add(history.Entry{Kind: "copy", Path: "a.jpg"})
	db.Begin("idle", start.Add(time.Second))

	changed, err := db.Following(ctx, "", history.ShowChanged, time.Time{}, time.Time{}, 10)
	if err != nil {
		t.Fatalf("following: %v", err)
	}
	if len(changed) != 1 || changed[0].Job != "busy" {
		t.Errorf("only runs that did something lists %+v", changed)
	}
	failed, err := db.Following(ctx, "", history.ShowFailed, time.Time{}, time.Time{}, 10)
	if err != nil {
		t.Fatalf("following: %v", err)
	}
	if len(failed) != 0 {
		t.Errorf("only errors lists %+v", failed)
	}
	later, err := db.Following(ctx, "", history.ShowAll, start.Add(time.Minute), time.Time{}, 10)
	if err != nil {
		t.Fatalf("following: %v", err)
	}
	if len(later) != 0 {
		t.Errorf("a range starting after both runs lists %+v", later)
	}
}
