package history_test

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

func TestLeftLastTimeNamesWhatTheJobsNewestRunLeftForLater(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	record := func(job string, at time.Time, entries ...history.Entry) {
		t.Helper()
		if err := db.Record(ctx, history.Run{Job: job, Started: at, Finished: at}, entries); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	record("x", now.Add(-2*time.Hour), history.Entry{Kind: "skip", Path: "old.txt"})
	record("x", now.Add(-time.Hour),
		history.Entry{Kind: "skip", Path: "a.txt"},
		history.Entry{Kind: "copy", Path: "copied.txt"},
		history.Entry{Kind: "skip", Path: "b.txt"},
	)
	record("y", now, history.Entry{Kind: "skip", Path: "other.txt"})

	got, err := db.LeftLastTime(ctx, "x")
	if err != nil {
		t.Fatalf("left last time: %v", err)
	}
	if want := map[string]bool{"a.txt": true, "b.txt": true}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestLeftLastTimeIsEmptyForAJobThatNeverRan(t *testing.T) {
	got, err := openTemp(t).LeftLastTime(context.Background(), "x")
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v, want nothing", got, err)
	}
}
