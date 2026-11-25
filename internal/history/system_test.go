package history

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func openSystemLog(t *testing.T) *DB {
	t.Helper()
	db, err := Open(context.Background(), filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestTheSystemLogListsTheNewestFirst(t *testing.T) {
	ctx := context.Background()
	db := openSystemLog(t)
	at := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	lines := []SystemLine{
		{At: at, Source: "rclone", Text: "Failed to copy: disk full"},
		{At: at.Add(time.Minute), Source: "connection", Text: "photos: dial tcp: connection refused"},
		{At: at.Add(2 * time.Minute), Source: "integration", Text: "fortress: could not join the fortress"},
	}
	if err := db.AddSystemLog(ctx, lines); err != nil {
		t.Fatalf("add: %v", err)
	}

	got, err := db.SystemLog(ctx, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("read %d lines, want 3", len(got))
	}
	for i, want := range []SystemLine{lines[2], lines[1], lines[0]} {
		if got[i].Source != want.Source || got[i].Text != want.Text || !got[i].At.Equal(want.At) || got[i].Count != 1 {
			t.Errorf("line %d is %+v, want %+v seen once", i, got[i], want)
		}
	}
}

func TestAnErrorRepeatedInARowIsOneLineWithACount(t *testing.T) {
	ctx := context.Background()
	db := openSystemLog(t)
	at := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	same := func(min int) SystemLine {
		return SystemLine{At: at.Add(time.Duration(min) * time.Minute), Source: "connection", Text: "nas: no route to host"}
	}
	if err := db.AddSystemLog(ctx, []SystemLine{same(0), same(1)}); err != nil {
		t.Fatalf("add: %v", err)
	}
	if err := db.AddSystemLog(ctx, []SystemLine{same(5)}); err != nil {
		t.Fatalf("add: %v", err)
	}

	got, err := db.SystemLog(ctx, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != 1 || got[0].Count != 3 || !got[0].At.Equal(same(5).At) {
		t.Fatalf("read %+v, want one line seen three times, last at %v", got, same(5).At)
	}

	other := SystemLine{At: at.Add(6 * time.Minute), Source: "rclone", Text: "nas: no route to host"}
	if err := db.AddSystemLog(ctx, []SystemLine{other, same(7)}); err != nil {
		t.Fatalf("add: %v", err)
	}
	if got, _ := db.SystemLog(ctx, 10); len(got) != 3 || got[0].Count != 1 {
		t.Errorf("read %+v, want the same words from another source to start a line of their own", got)
	}
}

func TestTheSystemLogKeepsOnlyItsNewestLines(t *testing.T) {
	ctx := context.Background()
	db := openSystemLog(t)
	at := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	var lines []SystemLine
	for i := range SystemLogKeep + 20 {
		lines = append(lines, SystemLine{At: at.Add(time.Duration(i) * time.Second), Source: "rclone", Text: fmt.Sprintf("Failed to copy file %d", i)})
	}
	if err := db.AddSystemLog(ctx, lines); err != nil {
		t.Fatalf("add: %v", err)
	}

	got, err := db.SystemLog(ctx, 2*SystemLogKeep)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != SystemLogKeep {
		t.Fatalf("kept %d lines, want %d", len(got), SystemLogKeep)
	}
	if newest, oldest := got[0].Text, got[len(got)-1].Text; newest != fmt.Sprintf("Failed to copy file %d", SystemLogKeep+19) || oldest != "Failed to copy file 20" {
		t.Errorf("kept %q to %q, want the newest lines", oldest, newest)
	}
}

func TestPruningTrimsTheSystemLogLikeTheRuns(t *testing.T) {
	ctx := context.Background()
	db := openSystemLog(t)
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	if err := db.AddSystemLog(ctx, []SystemLine{
		{At: now.Add(-100 * day), Source: "rclone", Text: "old"},
		{At: now.Add(-day), Source: "rclone", Text: "recent"},
	}); err != nil {
		t.Fatalf("add: %v", err)
	}

	if _, err := db.Prune(ctx, 90*day, now); err != nil {
		t.Fatalf("prune: %v", err)
	}
	got, err := db.SystemLog(ctx, 10)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(got) != 1 || got[0].Text != "recent" {
		t.Errorf("after the prune the log holds %+v, want only the recent line", got)
	}
}
