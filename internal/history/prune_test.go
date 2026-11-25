package history

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// When a job is due next, whether it is backing off and what its last run
// left for later are read from its newest runs, so a job that has not run for
// longer than the log keeps must not lose them.
func TestPruningKeepsWhatAJobIsScheduledFrom(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	keep := 90 * 24 * time.Hour
	at := func(days int) time.Time { return now.Add(-time.Duration(days) * 24 * time.Hour) }
	runs := []struct {
		run     Run
		entries []Entry
	}{
		{Run{Job: "paused", Started: at(400), Copied: 1}, nil},
		{Run{Job: "paused", Started: at(300), Copied: 2}, nil},
		{Run{Job: "paused", Started: at(250), Stopped: true}, nil},
		{Run{Job: "paused", Started: at(200), Stopped: true}, nil},
		{Run{Job: "paused", Started: at(150), Err: "the drive is gone"}, []Entry{{Kind: "skip", Path: "left.txt"}}},
		{Run{Job: "daily", Started: at(200), Copied: 1}, nil},
		{Run{Job: "daily", Started: at(1), Copied: 1}, nil},
	}
	for _, r := range runs {
		r.run.Finished = r.run.Started.Add(time.Minute)
		if err := db.Record(ctx, r.run, r.entries); err != nil {
			t.Fatalf("record: %v", err)
		}
	}

	n, err := db.Prune(ctx, keep, now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if n != 3 {
		t.Errorf("pruned %d runs, want the older success and stop of the paused job and the old run of the daily one", n)
	}

	if last, ok, err := db.LastSuccess(ctx, "paused"); err != nil || !ok || !last.Equal(at(300).Add(time.Minute)) {
		t.Errorf("the paused job's last success reads %v, %v (%v), want the one 300 days ago", last, ok, err)
	}
	if last, ok, err := db.LastStopped(ctx, "paused"); err != nil || !ok || !last.Equal(at(200).Add(time.Minute)) {
		t.Errorf("the paused job was last stopped %v, %v (%v), want 200 days ago", last, ok, err)
	}
	if fails, _, err := db.FailuresSince(ctx, "paused", at(300)); err != nil || fails != 1 {
		t.Errorf("the paused job has %d failures since its success (%v), want its newest run", fails, err)
	}
	if left, err := db.LeftLastTime(ctx, "paused"); err != nil || !left["left.txt"] {
		t.Errorf("the paused job's newest run left %v (%v), want left.txt", left, err)
	}
	daily, err := db.Recent(ctx, "daily", ShowAll, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(daily) != 1 || !daily[0].Started.Equal(at(1)) {
		t.Errorf("the daily job kept %+v, want only yesterday's run", daily)
	}
}

// The next trim is counted from the last one, which has to outlive the
// program and every reload of its configuration.
func TestPruningNotesWhenItRan(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, ok, err := db.LastPruned(ctx); err != nil || ok {
		t.Fatalf("a new log reads as pruned before (%v, %v)", ok, err)
	}
	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	if _, err := db.Prune(ctx, time.Hour, now); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, err := db.Prune(ctx, time.Hour, now.Add(24*time.Hour)); err != nil {
		t.Fatalf("prune: %v", err)
	}
	db.Close()

	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("open again: %v", err)
	}
	defer db.Close()
	last, ok, err := db.LastPruned(ctx)
	if err != nil || !ok || !last.Equal(now.Add(24*time.Hour)) {
		t.Errorf("the log was last pruned %v, %v (%v), want the second prune", last, ok, err)
	}
}

// Deleted rows only leave free pages behind, and a log that has grown for
// months would keep its size on disk after the first trim without this.
func TestALargePruneShrinksTheFile(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	entries := make([]Entry, 200)
	for i := range entries {
		entries[i] = Entry{Kind: "copy", Side: "right", Path: fmt.Sprintf("photos/2026/%04d/%s.jpg", i, strings.Repeat("x", 60)), Size: 1 << 20}
	}
	for day := 100; day > 0; day-- {
		started := now.Add(-time.Duration(day) * 24 * time.Hour)
		if err := db.Record(ctx, Run{Job: "photos", Started: started, Finished: started.Add(time.Minute), Copied: len(entries)}, entries); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	before := fileSize(t, path)

	if _, err := db.Prune(ctx, 10*24*time.Hour, now); err != nil {
		t.Fatalf("prune: %v", err)
	}
	after := fileSize(t, path)
	t.Logf("a hundred days of runs take %d KiB, the last ten days %d KiB", before>>10, after>>10)
	if after > before/4 {
		t.Errorf("the file went from %d to %d bytes after dropping 90 of 100 runs", before, after)
	}
	runs, err := db.Recent(ctx, "photos", ShowAll, 20)
	if err != nil || len(runs) != 10 {
		t.Fatalf("%d runs left (%v), want ten", len(runs), err)
	}
	got, err := db.Entries(ctx, runs[0].ID)
	if err != nil || len(got) != len(entries) {
		t.Errorf("the newest run kept %d entries (%v), want %d", len(got), err, len(entries))
	}
}

// The file is shared with any other program on it and with the interface
// reading the log, and rewriting it must not fail their reads or records.
func TestALargePruneLetsOthersReadAndRecord(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	other, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open a second time: %v", err)
	}
	defer other.Close()

	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	entries := make([]Entry, 200)
	for i := range entries {
		entries[i] = Entry{Kind: "copy", Path: fmt.Sprintf("%04d/%s", i, strings.Repeat("x", 100))}
	}
	for day := 60; day > 0; day-- {
		started := now.Add(-time.Duration(day) * 24 * time.Hour)
		if err := db.Record(ctx, Run{Job: "photos", Started: started, Finished: started}, entries); err != nil {
			t.Fatalf("record: %v", err)
		}
	}

	done := make(chan error, 1)
	go func() {
		_, err := db.Prune(ctx, 24*time.Hour, now)
		done <- err
	}()
	for i := 0; ; i++ {
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("prune: %v", err)
			}
			if _, err := other.Recent(ctx, "", ShowAll, 200); err != nil {
				t.Fatalf("read after the prune: %v", err)
			}
			return
		default:
		}
		if _, err := other.Recent(ctx, "photos", ShowAll, 5); err != nil {
			t.Fatalf("read while pruning: %v", err)
		}
		at := now.Add(time.Duration(i) * time.Second)
		if err := other.Record(ctx, Run{Job: "music", Started: at, Finished: at}, entries[:5]); err != nil {
			t.Fatalf("record while pruning: %v", err)
		}
		live := db.Begin(Run{Job: "films", Started: at})
		live.Add(Entry{Kind: "copy", Path: "a.mkv"})
		if err := live.Record(ctx, Run{Job: "films", Started: at, Finished: at, Copied: 1}); err != nil {
			t.Fatalf("record a live run while pruning: %v", err)
		}
	}
}

// fileSize is what the database takes on disk, with its write-ahead log.
func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	var total int64
	for _, p := range []string{path, path + "-wal"} {
		info, err := os.Stat(p)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		total += info.Size()
	}
	return total
}
