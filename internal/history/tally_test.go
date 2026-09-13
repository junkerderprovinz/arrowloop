package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// The summary a status card reads, counted over the WHOLE run.
//
// jdp: "eine kleine zusammenfassung wie viele datien hoch- und runtergeladen
// und gelöscht wurden etc."
//
// The count has to come from the database, not from the page of entries a
// screen can fetch: a run over three thousand files writes six thousand lines
// and the entries endpoint hands back two hundred. Counting those would report
// "200 uploaded" for a run that uploaded three thousand - a wrong number that
// looks exactly like a right one.
func TestTheSummaryCountsEveryLineAndSplitsBySide(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	// More lines than any page a screen asks for, so a summary that quietly
	// counted a page would come back short.
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
		// A move writes the copy that landed AND the source going away. Only
		// the copy is a transfer; counting the second line would turn every
		// one-way move job into one that moves files both ways.
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
	// The two deletions are one per side, and the split has to say so: a total
	// of "2 gelöscht" on a two-way job leaves the reader guessing which end
	// lost the files, which is the one thing a deletion count is checked for.
	// Autosync says it on two lines ("Vom Gerät gelöscht", "Von Cloud
	// gelöscht") and jdp asked for that page.
	want := history.Tally{Up: 250, Down: 7, Trashed: 2, Conflicts: 1, TrashedLeft: 1, TrashedRight: 1}
	if got != want {
		t.Errorf("summary = %+v, want %+v", got, want)
	}
	// And the halves add up to the total, which is the contract that lets a
	// one-way job keep showing the single number.
	if got.TrashedLeft+got.TrashedRight != got.Trashed {
		t.Errorf("the split %d+%d does not add up to %d", got.TrashedLeft, got.TrashedRight, got.Trashed)
	}
}

// A deletion with no side lands in the total and in neither half.
//
// It is not a shape the engine writes today, and that is exactly why it is
// pinned: the split must never invent a side, because "deleted from the phone"
// is a sentence somebody acts on.
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

// A run nobody recorded lines for summarises to nothing, rather than failing.
//
// It is an ordinary state: a run that found nothing to do writes no entries at
// all, and the card above it still has to draw something.
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
