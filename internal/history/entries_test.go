package history_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func openTemp(t *testing.T) *history.DB {
	t.Helper()
	db, err := history.Open(context.Background(), filepath.Join(t.TempDir(), "runs.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestARunAndWhatItDidArriveTogether.
//
// A run row without its entries reads as a run that touched nothing, which is
// exactly the picture somebody would be handed about the run they most want to
// look into. The two writes therefore share one transaction, and this checks
// they actually arrive together rather than merely being written next to each
// other.
func TestARunAndWhatItDidArriveTogether(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	entries := []history.Entry{
		{Kind: "copy", Side: "right", Path: "photos/a.jpg"},
		{Kind: "conflict", Path: "notes.txt", Note: "keep both"},
		{Kind: "skip", Path: "big.iso", Note: "copy failed: permission denied"},
	}
	if err := db.Record(ctx, history.Run{Job: "x", Started: now, Finished: now}, entries); err != nil {
		t.Fatalf("record: %v", err)
	}

	runs, err := db.Recent(ctx, "x", 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	got, err := db.Entries(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(got) != len(entries) {
		t.Fatalf("wrote %d entries and read back %d", len(entries), len(got))
	}
	for i := range entries {
		if got[i] != entries[i] {
			t.Errorf("entry %d came back as %+v, wrote %+v", i, got[i], entries[i])
		}
	}
}

// TestTheOrderIsTheOrderItHappenedIn.
//
// Not a nicety. Reading down the list of a FAILED run is how somebody works out
// what it got through before it stopped, and a list sorted by path or by
// whatever the database felt like answers a different question.
func TestTheOrderIsTheOrderItHappenedIn(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Now()

	// Deliberately not in alphabetical order, so a sort by path would show.
	want := []string{"zebra", "apple", "mango", "banana"}
	var entries []history.Entry
	for _, p := range want {
		entries = append(entries, history.Entry{Kind: "copy", Path: p})
	}
	if err := db.Record(ctx, history.Run{Job: "x", Started: now, Finished: now}, entries); err != nil {
		t.Fatalf("record: %v", err)
	}

	runs, _ := db.Recent(ctx, "x", 1)
	got, err := db.Entries(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	for i, p := range want {
		if got[i].Path != p {
			t.Fatalf("entry %d is %q, expected %q: the list is not in the order it happened", i, got[i].Path, p)
		}
	}
}

// TestEntriesBelongToTheirOwnRun.
//
// Two runs of the same job, and asking for one must not hand back the other's
// work. The obvious way to get this wrong is a query that filters by job rather
// than by run, which would look correct on a database holding one run.
func TestEntriesBelongToTheirOwnRun(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Now()

	if err := db.Record(ctx, history.Run{Job: "x", Started: now.Add(-time.Hour), Finished: now},
		[]history.Entry{{Kind: "copy", Path: "first"}}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := db.Record(ctx, history.Run{Job: "x", Started: now, Finished: now},
		[]history.Entry{{Kind: "copy", Path: "second"}}); err != nil {
		t.Fatalf("record: %v", err)
	}

	runs, _ := db.Recent(ctx, "x", 10)
	if len(runs) != 2 {
		t.Fatalf("expected two runs, got %d", len(runs))
	}
	for _, r := range runs {
		got, err := db.Entries(ctx, r.ID)
		if err != nil {
			t.Fatalf("entries: %v", err)
		}
		if len(got) != 1 {
			t.Fatalf("run %d came back with %d entries, expected its own one", r.ID, len(got))
		}
	}
	// And the two runs must not have been handed the same list.
	a, _ := db.Entries(ctx, runs[0].ID)
	b, _ := db.Entries(ctx, runs[1].ID)
	if a[0].Path == b[0].Path {
		t.Errorf("both runs came back with %q, so entries are not tied to a run", a[0].Path)
	}
}

// TestPruningTakesTheEntriesWithIt.
//
// SQLite does not enforce a foreign key unless it is asked to, so nothing would
// complain about entries whose run no longer exists. They would sit in the file
// for ever, invisible and growing, which is the exact failure pruning exists to
// prevent - and the count pruning reports would keep looking right.
func TestPruningTakesTheEntriesWithIt(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	old := now.Add(-200 * 24 * time.Hour)
	if err := db.Record(ctx, history.Run{Job: "x", Started: old, Finished: old},
		[]history.Entry{{Kind: "copy", Path: "ancient"}}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := db.Record(ctx, history.Run{Job: "x", Started: now, Finished: now},
		[]history.Entry{{Kind: "copy", Path: "recent"}}); err != nil {
		t.Fatalf("record: %v", err)
	}

	runs, _ := db.Recent(ctx, "x", 10)
	var oldID int64
	for _, r := range runs {
		if r.Started.Equal(old) {
			oldID = r.ID
		}
	}
	if oldID == 0 {
		t.Fatal("could not find the old run")
	}

	if _, err := db.Prune(ctx, 90*24*time.Hour, now); err != nil {
		t.Fatalf("prune: %v", err)
	}

	left, err := db.Entries(ctx, oldID)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(left) != 0 {
		t.Errorf("%d entries survived the run they belonged to", len(left))
	}
	// The recent run keeps its own, or pruning is deleting too much.
	runs, _ = db.Recent(ctx, "x", 10)
	if len(runs) != 1 {
		t.Fatalf("expected one run left, got %d", len(runs))
	}
	kept, _ := db.Entries(ctx, runs[0].ID)
	if len(kept) != 1 {
		t.Errorf("the surviving run lost its entries: %d left", len(kept))
	}
}

// TestARunWithNothingToSayIsStillARun.
//
// The common case: a job that found nothing to do. It records no entries, and
// that must not be an error or a missing row.
func TestARunWithNothingToSayIsStillARun(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Now()

	if err := db.Record(ctx, history.Run{Job: "x", Started: now, Finished: now}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	runs, err := db.Recent(ctx, "x", 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	got, err := db.Entries(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("a run that did nothing came back with %d entries", len(got))
	}
}
