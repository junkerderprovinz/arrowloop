package state

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"testing"
	"time"
)

func TestASnapshotHoldsWhatAnOpenDatabaseHasNotWrittenBack(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "photos.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	at := time.Unix(1700000000, 0)
	if err := db.Put(ctx, Entry{Path: "a.jpg", LeftPath: "a.jpg", RightPath: "a.jpg", LeftSize: 3, RightSize: 3, LeftMod: at, RightMod: at, AgreedAt: at}); err != nil {
		t.Fatal(err)
	}

	copied := filepath.Join(dir, "copy.db")
	if err := Snapshot(ctx, path, copied); err != nil {
		t.Fatal(err)
	}
	snap, err := Open(ctx, copied)
	if err != nil {
		t.Fatal(err)
	}
	defer snap.Close()
	if e, ok, err := snap.Get(ctx, "a.jpg"); err != nil || !ok || e.LeftSize != 3 {
		t.Fatalf("the snapshot holds %+v, %v, %v; want a.jpg", e, ok, err)
	}
}

func TestASnapshotOfAMissingDatabaseSaysSo(t *testing.T) {
	dir := t.TempDir()
	err := Snapshot(context.Background(), filepath.Join(dir, "never.db"), filepath.Join(dir, "copy.db"))
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("a database that was never written: %v, want fs.ErrNotExist", err)
	}
}
