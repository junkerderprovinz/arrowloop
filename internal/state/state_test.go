package state

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestOnlyOneWriterEverReachesTheDatabase.
//
// Records are written from every transfer worker at once. Left to itself the
// connection pool hands each worker a connection of its own, and they contend
// for SQLite's single write lock: the busy handler waits, and on a slow disk it
// waits past its timeout. The write then fails with SQLITE_BUSY and the file is
// reported as postponed with its record missing.
//
// This is asserted structurally rather than by racing, because a race that only
// shows up on a loaded machine is a test that passes on the machine you are
// looking at and fails on the one you are not. It did exactly that: green on
// this laptop over six consecutive runs, red on a Windows runner, five files at
// a time.
func TestOnlyOneWriterEverReachesTheDatabase(t *testing.T) {
	db := openTemp(t)
	if got := db.sql.Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("the pool allows %d connections, so that many writers can contend for one write lock", got)
	}
}

// TestConcurrentRecordsAllArrive exercises the path the structural check above
// protects: every worker's record has to be there afterwards, and none of them
// may fail.
func TestConcurrentRecordsAllArrive(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()

	const workers, each = 16, 40
	var wg sync.WaitGroup
	errs := make(chan error, workers*each)
	for w := range workers {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := range each {
				path := fmt.Sprintf("dir%d/file%03d.txt", w, i)
				err := db.Put(ctx, Entry{
					Path: path, LeftPath: path, RightPath: path,
					LeftSize: int64(i), RightSize: int64(i),
					LeftMod: time.Unix(1700000000, 0), RightMod: time.Unix(1700000000, 0),
					AgreedAt: time.Unix(1700000001, 0),
				})
				if err != nil {
					errs <- err
				}
			}
		}(w)
	}
	wg.Wait()
	close(errs)

	var failed int
	for err := range errs {
		if failed == 0 {
			t.Errorf("a record could not be written: %v", err)
		}
		failed++
	}
	if failed > 0 {
		t.Errorf("%d of %d records failed to write", failed, workers*each)
	}

	all, err := db.All(ctx)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	// The count is the part that matters. A missing record is not a missing
	// file: both sides hold it and the job has no note of it, so the next run
	// files it under "appeared on both sides" rather than "unchanged" and
	// nothing ever says anything went wrong.
	if len(all) != workers*each {
		t.Errorf("%d of %d records are in the database", len(all), workers*each)
	}
}

func openTemp(t *testing.T) *DB {
	t.Helper()
	db, err := Open(context.Background(), filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestOpenMakesTheFolderItWasAskedToWriteInto.
//
// SQLite creates the file and refuses to create the folder, and its refusal is
// SQLITE_CANTOPEN: "unable to open database file", which names a file and
// means a directory. Every job the interface creates points at
// "state/<name>.db", so without this the ordinary case was the broken one.
func TestOpenMakesTheFolderItWasAskedToWriteInto(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state", "Test.db")

	db, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open a database under a folder that does not exist yet: %v", err)
	}
	defer db.Close()

	// Opened is not enough: the schema has to have been written, which is the
	// step that actually failed.
	if err := db.Put(context.Background(), Entry{Path: "a.txt", LeftSize: 1, RightSize: 1}); err != nil {
		t.Fatalf("write to the new database: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the database file is not where it was asked for: %v", err)
	}
}

// TestOpenLeavesAnExistingFolderAlone keeps the fix from becoming a habit of
// creating folders on paths that already have one, which is where a wrong
// mkdir would quietly change permissions on somebody's directory.
func TestOpenLeavesAnExistingFolderAlone(t *testing.T) {
	root := t.TempDir()
	before, err := os.Stat(root)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	db, err := Open(context.Background(), filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	after, err := os.Stat(root)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if before.Mode() != after.Mode() {
		t.Fatalf("the folder's mode changed from %v to %v", before.Mode(), after.Mode())
	}
}
