package state

import (
	"context"
	"fmt"
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
