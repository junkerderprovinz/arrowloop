package scan

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"
)

// localEntry lists a directory holding one file and returns that file's entry.
func localEntry(t *testing.T) *Entry {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "song.flac"), []byte("AAAA"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	f, err := fs.NewFs(context.Background(), dir)
	if err != nil {
		t.Fatalf("fs: %v", err)
	}
	l, err := List(context.Background(), f, Options{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	e, ok := l.Files["song.flac"]
	if !ok {
		t.Fatal("the listing does not hold the file")
	}
	return e
}

// A local disk has to read a file to its end for its checksum, so the cheap
// comparison must not ask for one.
func TestCheapHashLeavesALocalFileUnread(t *testing.T) {
	e := localEntry(t)

	if got := e.CheapHash(context.Background()); got != "" {
		t.Errorf("a local file was read for a cheap comparison and gave %q", got)
	}
	if e.hashed {
		t.Error("the cheap comparison read the file")
	}
	// The MD5 of "AAAA", written out rather than computed with the library.
	if got := e.Hash(context.Background()); got != "098890dde069e9abad63f19a0d9e1f32" {
		t.Errorf("asked outright, the checksum was %q", got)
	}
}

func TestAStoppedRunReadsNoChecksum(t *testing.T) {
	e := localEntry(t)
	ctx, stop := context.WithCancel(context.Background())
	stop()

	if got := e.Hash(ctx); got != "" {
		t.Errorf("a stopped run still read the file and got %q", got)
	}
	if e.hashed {
		t.Error("the empty answer of a stopped run was kept, so a later run would never read the file")
	}
}
