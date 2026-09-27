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

// Asserted on the pool rather than by racing writers, because the contention
// only shows up on a loaded machine.
func TestOnlyOneWriterEverReachesTheDatabase(t *testing.T) {
	db := openTemp(t)
	if got := db.sql.Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("the pool allows %d connections, so that many writers can contend for one write lock", got)
	}
}

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

// SQLite creates the file but not its folder, and jobs created in the interface
// point at "state/<name>.db".
func TestOpenMakesTheFolderItWasAskedToWriteInto(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "state", "Test.db")

	db, err := Open(context.Background(), path)
	if err != nil {
		t.Fatalf("open a database under a folder that does not exist yet: %v", err)
	}
	defer db.Close()

	if err := db.Put(context.Background(), Entry{Path: "a.txt", LeftSize: 1, RightSize: 1}); err != nil {
		t.Fatalf("write to the new database: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the database file is not where it was asked for: %v", err)
	}
}

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

func TestAFragmentFindsOnlyTheRowsThatHoldIt(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	for _, path := range []string{"a/notes.txt", "a/notes.conflict-left-20260101-000000.txt", "b_c/other.txt"} {
		if err := db.Put(ctx, Entry{Path: path, LeftPath: path, RightPath: path}); err != nil {
			t.Fatalf("put %s: %v", path, err)
		}
	}
	got, err := db.Containing(ctx, ".conflict-")
	if err != nil {
		t.Fatalf("containing: %v", err)
	}
	if len(got) != 1 || got[0].Path != "a/notes.conflict-left-20260101-000000.txt" {
		t.Fatalf("expected the one copy, got %+v", got)
	}
	// An underscore is a wildcard to LIKE and must be an ordinary character here.
	if got, _ := db.Containing(ctx, "b_c"); len(got) != 1 {
		t.Fatalf("the underscore did not match itself: %+v", got)
	}
	if got, _ := db.Containing(ctx, "a_n"); len(got) != 0 {
		t.Fatalf("the underscore matched another character: %+v", got)
	}
}

func TestAKeptFileIsForgottenWithItsRecord(t *testing.T) {
	db := openTemp(t)
	ctx := context.Background()
	const path = "notes.conflict-right-20260101-000000.txt"
	if err := db.Put(ctx, Entry{Path: path, LeftPath: path, RightPath: path}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := db.Keep(ctx, path, time.Now()); err != nil {
		t.Fatalf("keep: %v", err)
	}
	if kept, err := db.Kept(ctx); err != nil || !kept[path] {
		t.Fatalf("the decision was not recorded: %v %v", kept, err)
	}
	if _, found, err := db.Get(ctx, path); err != nil || !found {
		t.Fatalf("get: found %v, %v", found, err)
	}

	if err := db.Forget(ctx, path); err != nil {
		t.Fatalf("forget: %v", err)
	}
	if kept, _ := db.Kept(ctx); kept[path] {
		t.Error("the decision outlived the file it was about")
	}
	if _, found, _ := db.Get(ctx, path); found {
		t.Error("the record outlived Forget")
	}
}
