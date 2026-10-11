package history

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func openAt(t *testing.T, path string) *DB {
	t.Helper()
	db, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return db
}

// kill ends a handle the way a killed program does: nothing more is written.
func kill(d *DB) {
	close(d.stop)
	<-d.done
	d.sql.Close()
}

func count(t *testing.T, d *DB, table string) int {
	t.Helper()
	var n int
	if err := d.sql.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestARunCutOffByAKillIsRecordedAtTheNextStart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "runs.db")
	first := openAt(t, path)
	start := time.Now().Add(-10 * time.Minute)

	live := first.Begin("photos", start)
	live.Add(Entry{Kind: "copy", Side: "right", Path: "a.jpg", Size: 10})
	if err := first.checkpoint(ctx, start.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	live.Add(Entry{Kind: "mkdir", Side: "right", Path: "b"})
	last := start.Add(2 * time.Minute)
	if err := first.checkpoint(ctx, last); err != nil {
		t.Fatal(err)
	}
	live.Add(Entry{Kind: "copy", Side: "right", Path: "never-written.jpg"})
	kill(first)

	again := openAt(t, path)
	defer again.Close()
	runs, err := again.Recent(ctx, "photos", ShowAll, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("the next start found %d runs, want the one cut off", len(runs))
	}
	r := runs[0]
	if r.Err != Interrupted || r.Copied != 1 || r.DirsMade != 1 || !r.Finished.Equal(time.Unix(0, last.UnixNano())) {
		t.Errorf("the run was recorded as %+v, want it interrupted after one copy and one folder at its last beat", r)
	}
	entries, err := again.Entries(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Path != "a.jpg" || entries[1].Path != "b" {
		t.Errorf("the run's lines read %+v, want a.jpg then b", entries)
	}
	if n := count(t, again, "going") + count(t, again, "going_entries"); n != 0 {
		t.Errorf("%d notes stayed behind after the record", n)
	}
}

// Two programs can share the file, and one must not record the other's run as
// interrupted while it still goes.
func TestARunThatStillBeatsIsLeftToItsOwnProgram(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "runs.db")
	busy := openAt(t, path)
	defer busy.Close()
	now := time.Now()

	live := busy.Begin("photos", now)
	live.Add(Entry{Kind: "copy", Path: "a.jpg"})
	if err := busy.checkpoint(ctx, now); err != nil {
		t.Fatal(err)
	}
	other := openAt(t, path)
	defer other.Close()
	if err := other.recordAbandoned(ctx, now.Add(staleAfter/2)); err != nil {
		t.Fatal(err)
	}
	if err := live.Record(ctx, Run{Job: "photos", Started: now, Finished: now.Add(time.Second), Copied: 1}); err != nil {
		t.Fatal(err)
	}
	runs, err := other.Recent(ctx, "photos", ShowAll, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].Err != "" {
		t.Errorf("the runs read %+v, want the one finished run", runs)
	}
}

// A laptop that slept leaves its own beat old, and its run is still going.
func TestAProgramNeverRecordsItsOwnRunAsInterrupted(t *testing.T) {
	ctx := context.Background()
	db := openAt(t, filepath.Join(t.TempDir(), "runs.db"))
	defer db.Close()
	now := time.Now()
	db.Begin("photos", now.Add(-time.Hour))
	if err := db.checkpoint(ctx, now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := db.recordAbandoned(ctx, now); err != nil {
		t.Fatal(err)
	}
	if n := count(t, db, "runs"); n != 0 {
		t.Errorf("the program recorded %d of its own runs as interrupted", n)
	}
}

func TestAFinishedOrDroppedRunLeavesNoNotes(t *testing.T) {
	ctx := context.Background()
	db := openAt(t, filepath.Join(t.TempDir(), "runs.db"))
	defer db.Close()
	now := time.Now()

	done := db.Begin("photos", now)
	done.Add(Entry{Kind: "copy", Path: "a.jpg"})
	held := db.Begin("music", now)
	held.Add(Entry{Kind: "copy", Path: "b.mp3"})
	if err := db.checkpoint(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := done.Record(ctx, Run{Job: "photos", Started: now, Finished: now, Copied: 1}); err != nil {
		t.Fatal(err)
	}
	held.Drop()
	if n := count(t, db, "going") + count(t, db, "going_entries"); n != 0 {
		t.Errorf("%d notes stayed behind", n)
	}
	if err := db.checkpoint(ctx, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if n := count(t, db, "going"); n != 0 {
		t.Errorf("a later beat wrote down %d runs that had ended", n)
	}
}
