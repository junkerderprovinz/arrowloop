package history_test

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// The per-file log, across every job, narrowed the way a screen asks.
//
// jdp: "in Autosync sieht man jede einzelne datei im Verlauf, es ist wie ein
// log, das moechte ich in AL auch haben. Eventuell mit Filterfunktoin etc."
//
// Every narrowing happens in the DATABASE. That is not an optimisation: this log
// runs to tens of thousands of rows while a screen holds a few dozen, so a
// filter applied after fetching would search the newest page instead of the log
// - and "which run touched that file" is exactly the question that cannot be
// answered from the newest page.
func TestTheLogSpansEveryJobAndNarrowsInTheDatabase(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	base := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	if err := db.Record(ctx,
		history.Run{Job: "Fotos", Started: base, Finished: base.Add(time.Second)},
		[]history.Entry{
			{Kind: "copy", Side: "right", Path: "urlaub/strand.jpg", Size: 12},
			{Kind: "trash", Side: "left", Path: "urlaub/alt.jpg", Size: 3},
		}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := db.Record(ctx,
		history.Run{Job: "Musik", Started: base.Add(time.Minute), Finished: base.Add(time.Minute + time.Second)},
		[]history.Entry{
			{Kind: "copy", Side: "right", Path: "alben/strand-lied.flac", Size: 9},
			// A kind this engine really writes. "error" is not one of them: a
			// failure is a `skip` carrying the reason, and a test that invents a
			// kind proves the SQL works on a value no run can produce.
			{Kind: "skip", Path: "alben/kaputt.flac", Note: "no space"},
		}); err != nil {
		t.Fatalf("record: %v", err)
	}

	// EVERY job, which is what the history tab asks and what the old query
	// could not express: it required a job name.
	all, err := db.Log(ctx, history.Filter{})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(all) != 4 {
		t.Fatalf("got %d rows across both jobs, want 4", len(all))
	}
	// Newest first, so the top of the screen is the most recent thing that
	// happened rather than the oldest.
	if all[0].Run == all[3].Run {
		t.Fatal("every row came from one run; the join is not spanning jobs")
	}
	// EVERY row names its job. Across jobs that is not decoration: a line
	// saying a photo was copied, without saying by which job, leaves the reader
	// to open the run to find out.
	if all[0].Job != "Musik" || all[3].Job != "Fotos" {
		t.Fatalf("the rows do not carry their job: %q first, %q last", all[0].Job, all[3].Job)
	}

	one, err := db.Log(ctx, history.Filter{Job: "Fotos"})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(one) != 2 {
		t.Fatalf("narrowed to one job gave %d rows, want 2", len(one))
	}

	// A fragment of a path, CROSSING jobs: the whole reason to filter in the
	// database rather than on the page somebody happens to be looking at.
	found, err := db.Log(ctx, history.Filter{Contains: "strand"})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(found) != 2 {
		t.Fatalf("searching for strand gave %d rows, want 2 across both jobs", len(found))
	}

	kinds, err := db.Log(ctx, history.Filter{Kinds: []string{"skip", "trash"}})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(kinds) != 2 {
		t.Fatalf("two kinds gave %d rows, want 2", len(kinds))
	}
	for _, k := range kinds {
		if k.Kind != "skip" && k.Kind != "trash" {
			t.Errorf("a %q row came back from a filter that did not ask for it", k.Kind)
		}
	}

	both, err := db.Log(ctx, history.Filter{Job: "Musik", Kinds: []string{"copy"}, Contains: "strand"})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(both) != 1 || both[0].Path != "alben/strand-lied.flac" {
		t.Fatalf("the three filters together gave %v", both)
	}
}

// An underscore is in most paths and is also LIKE's own wildcard for "any single
// character". Unescaped it matches everything, which reads as a filter that does
// nothing rather than as a bug.
func TestAPathWildcardIsEscaped(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	if err := db.Record(ctx,
		history.Run{Job: "Fotos", Started: now, Finished: now},
		[]history.Entry{
			{Kind: "copy", Path: "mein_bild.jpg"},
			{Kind: "copy", Path: "meinXbild.jpg"},
		}); err != nil {
		t.Fatalf("record: %v", err)
	}

	got, err := db.Log(ctx, history.Filter{Contains: "mein_bild"})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(got) != 1 || got[0].Path != "mein_bild.jpg" {
		t.Fatalf("the underscore matched as a wildcard: %v", got)
	}
}

// A filter nobody filled in shows the newest page, not an empty screen.
func TestAZeroLimitTakesTheDefault(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)

	if err := db.Record(ctx,
		history.Run{Job: "Fotos", Started: now, Finished: now},
		[]history.Entry{{Kind: "copy", Path: "a.jpg"}}); err != nil {
		t.Fatalf("record: %v", err)
	}

	got, err := db.Log(ctx, history.Filter{Limit: 0})
	if err != nil {
		t.Fatalf("log: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("a zero limit returned %d rows, want the default page", len(got))
	}
}
