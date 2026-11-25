package history

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

// What a run sent across is the files it copied. A file that left for the
// other side is counted once, by its copy, and a file put in the trash or
// renamed in place sent nothing.
func TestARunCountsTheBytesOfWhatItCopied(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	started := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	live := db.Begin(Run{Job: "photos", Started: started})
	for _, e := range []Entry{
		{Kind: "copy", Side: "right", Path: "a.jpg", Size: 2000},
		{Kind: "copy", Side: "right", Path: "b.jpg", Note: "relocated", Size: 500},
		{Kind: "move", Side: "left", Path: "b.jpg", Note: "relocated", Size: 500},
		{Kind: "move", Side: "right", Path: "c.jpg", Note: "old/c.jpg", Size: 700},
		{Kind: "trash", Side: "left", Path: "d.jpg", Size: 300},
	} {
		live.Add(e)
	}

	going, err := db.Following(ctx, "", ShowAll, time.Time{}, time.Time{}, 10)
	if err != nil || len(going) != 1 {
		t.Fatalf("following: %v, %v", going, err)
	}
	if going[0].Bytes != 2500 {
		t.Errorf("the run going has sent %d bytes, want 2500", going[0].Bytes)
	}

	if err := live.Record(ctx, Run{Job: "photos", Started: started, Finished: started.Add(time.Minute), Copied: 2, Moved: 2, Trashed: 1}); err != nil {
		t.Fatalf("record: %v", err)
	}
	runs, err := db.Recent(ctx, "photos", ShowAll, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %v", runs, err)
	}
	if runs[0].Bytes != 2500 {
		t.Errorf("the recorded run sent %d bytes, want 2500", runs[0].Bytes)
	}
	raw, err := json.Marshal(runs[0])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var sent struct{ Bytes int64 }
	if err := json.Unmarshal(raw, &sent); err != nil || sent.Bytes != 2500 {
		t.Errorf("the interface is told %s", raw)
	}
}

// A log written before the bytes were kept works them out once from the
// entries its runs already have.
func TestAnOlderLogLearnsWhatItsRunsSent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	started := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	if err := db.Record(ctx, Run{Job: "photos", Started: started, Finished: started, Copied: 2}, []Entry{
		{Kind: "copy", Path: "a.jpg", Size: 1 << 20},
		{Kind: "copy", Path: "b.jpg", Size: 1 << 20},
		{Kind: "trash", Path: "c.jpg", Size: 1 << 30},
	}); err != nil {
		t.Fatalf("record: %v", err)
	}
	if _, err := db.sql.ExecContext(ctx, `ALTER TABLE runs DROP COLUMN bytes`); err != nil {
		t.Fatalf("take the column away again: %v", err)
	}
	db.Close()

	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("open again: %v", err)
	}
	defer db.Close()
	runs, err := db.Recent(ctx, "photos", ShowAll, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %v", runs, err)
	}
	if runs[0].Bytes != 2<<20 {
		t.Errorf("the older run sent %d bytes, want two MiB", runs[0].Bytes)
	}
}

// A run its program left behind is recorded by the next start with what it
// had sent so far.
func TestARunLeftBehindKeepsTheBytesItSent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	first := openAt(t, path)
	start := time.Now().Add(-10 * time.Minute)
	live := first.Begin(Run{Job: "photos", Started: start})
	live.Add(Entry{Kind: "copy", Side: "right", Path: "a.jpg", Size: 4096})
	if err := first.checkpoint(ctx, start.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	kill(first)

	again := openAt(t, path)
	defer again.Close()
	runs, err := again.Recent(ctx, "photos", ShowAll, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %v", runs, err)
	}
	if runs[0].Bytes != 4096 {
		t.Errorf("the run left behind sent %d bytes, want 4096", runs[0].Bytes)
	}
}
