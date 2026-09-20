package history

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// filled records five days of runs with the wanted row in the oldest, past any
// limit a screen would use, so narrowing after the fetch would miss it.
func filled(t *testing.T) *DB {
	t.Helper()
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	base := time.Date(2026, 3, 1, 9, 0, 0, 0, time.Local)
	for day := 0; day < 5; day++ {
		started := base.AddDate(0, 0, day)
		entries := []Entry{}
		if day == 0 {
			entries = append(entries, Entry{Kind: "copy", Side: "right", Path: "urlaub/nadel.raw", Size: 99})
		}
		for i := 0; i < 40; i++ {
			entries = append(entries, Entry{Kind: "copy", Side: "right", Path: "heu/datei.txt", Size: 1})
		}
		run := Run{Job: "test", Started: started, Finished: started.Add(time.Minute), Copied: len(entries)}
		if err := db.Record(ctx, run, entries); err != nil {
			t.Fatalf("record day %d: %v", day, err)
		}
	}
	return db
}

func TestTheActivityLogFindsAPathPastTheLimit(t *testing.T) {
	db := filled(t)
	// 200 rows sit on top of the needle.
	got, err := db.TouchesLike(context.Background(), "test", "nadel", 20)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("found %d rows, wanted the one", len(got))
	}
	if got[0].Path != "urlaub/nadel.raw" {
		t.Errorf("found %q", got[0].Path)
	}
}

func TestTheSearchDoesNotTreatAnUnderscoreAsAWildcard(t *testing.T) {
	ctx := context.Background()
	db := filled(t)
	started := time.Date(2026, 3, 9, 9, 0, 0, 0, time.Local)
	if err := db.Record(ctx, Run{Job: "test", Started: started, Finished: started},
		[]Entry{{Kind: "copy", Path: "axb.txt"}, {Kind: "copy", Path: "a_b.txt"}}); err != nil {
		t.Fatalf("record: %v", err)
	}

	got, err := db.TouchesLike(ctx, "test", "a_b", 50)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(got) != 1 || got[0].Path != "a_b.txt" {
		names := make([]string, len(got))
		for i, g := range got {
			names[i] = g.Path
		}
		t.Errorf("the underscore matched as a wildcard: %v", names)
	}
}

func TestTheHistoryNarrowsToAStretchOfTime(t *testing.T) {
	ctx := context.Background()
	db := filled(t)

	// Both bounds name the same day, which breaks if the upper bound means
	// midnight rather than the day's end.
	day := time.Date(2026, 3, 3, 0, 0, 0, 0, time.Local)
	got, err := db.Between(ctx, "test", ShowAll, day, day.AddDate(0, 0, 1).Add(-time.Nanosecond), 50)
	if err != nil {
		t.Fatalf("between: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("asked for one day and got %d runs", len(got))
	}
	if !got[0].Started.Equal(time.Date(2026, 3, 3, 9, 0, 0, 0, time.Local)) {
		t.Errorf("got the run from %s", got[0].Started)
	}
}

func TestAnOpenEndedStretchIsOpenEnded(t *testing.T) {
	ctx := context.Background()
	db := filled(t)

	from := time.Date(2026, 3, 4, 0, 0, 0, 0, time.Local)
	got, err := db.Between(ctx, "test", ShowAll, from, time.Time{}, 50)
	if err != nil {
		t.Fatalf("between: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("everything since the 4th is two runs, got %d", len(got))
	}

	all, err := db.Between(ctx, "test", ShowAll, time.Time{}, time.Time{}, 50)
	if err != nil {
		t.Fatalf("between: %v", err)
	}
	if len(all) != 5 {
		t.Errorf("no bounds should give every run, got %d of 5", len(all))
	}
}
