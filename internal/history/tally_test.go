package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// The count comes from the database rather than from the page of entries a
// screen can fetch.
func TestTheSummaryCountsEveryLineAndSplitsBySide(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	// More lines than any page a screen asks for.
	var entries []history.Entry
	for i := 0; i < 250; i++ {
		entries = append(entries, history.Entry{Kind: "copy", Side: "right", Path: "hoch.jpg"})
	}
	for i := 0; i < 7; i++ {
		entries = append(entries, history.Entry{Kind: "copy", Side: "left", Path: "runter.jpg"})
	}
	entries = append(entries,
		history.Entry{Kind: "trash", Side: "left", Path: "weg.jpg"},
		history.Entry{Kind: "trash", Side: "right", Path: "auch-weg.jpg"},
		history.Entry{Kind: "conflict", Path: "streit.txt"},
		// A move writes the copy that landed and this line for the source
		// going away. Only the copy is a transfer.
		history.Entry{Kind: "move", Side: "left", Path: "hoch.jpg"},
		history.Entry{Kind: "skip", Path: "spaeter.txt", Note: "in use"},
	)

	if err := db.Record(ctx,
		history.Run{Job: "Fotos", Started: now, Finished: now},
		entries); err != nil {
		t.Fatalf("record: %v", err)
	}

	runs, err := db.Recent(ctx, "", history.ShowAll, 1)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}

	got, err := db.Summarise(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("summarise: %v", err)
	}
	want := history.Tally{Up: 250, Down: 7, Trashed: 2, Conflicts: 1, TrashedLeft: 1, TrashedRight: 1}
	if got != want {
		t.Errorf("summary = %+v, want %+v", got, want)
	}
	// A one-way job shows only the total, so the halves have to add up to it.
	if got.TrashedLeft+got.TrashedRight != got.Trashed {
		t.Errorf("the split %d+%d does not add up to %d", got.TrashedLeft, got.TrashedRight, got.Trashed)
	}
}

// The engine does not write a deletion without a side, but the split must never
// invent one.
func TestADeletionWithNoSideIsCountedOnceAndSplitNowhere(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	if err := db.Record(ctx,
		history.Run{Job: "Fotos", Started: now, Finished: now},
		[]history.Entry{{Kind: "trash", Path: "seitenlos.jpg"}}); err != nil {
		t.Fatalf("record: %v", err)
	}
	runs, err := db.Recent(ctx, "", history.ShowAll, 1)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	got, err := db.Summarise(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("summarise: %v", err)
	}
	if got.Trashed != 1 || got.TrashedLeft != 0 || got.TrashedRight != 0 {
		t.Errorf("summary = %+v, want one deletion in the total and none in either half", got)
	}
}

// A run that found nothing to do writes no entries.
func TestARunWithNoLinesSummarisesToZero(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	if err := db.Record(ctx, history.Run{Job: "Fotos", Started: now, Finished: now}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	runs, err := db.Recent(ctx, "", history.ShowAll, 1)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	got, err := db.Summarise(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("summarise: %v", err)
	}
	if (got != history.Tally{}) {
		t.Errorf("summary = %+v, want an empty one", got)
	}
}
