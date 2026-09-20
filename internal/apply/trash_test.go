package apply

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/trash"
)

// These tests call discard directly; the daemon's tests cover the wiring from a
// job's configuration down to it.

func binned(t *testing.T, s *versionSide) []trash.Entry {
	t.Helper()
	entries, err := trash.List(context.Background(), s.fs, trash.Trash)
	if err != nil {
		t.Fatalf("list the trash: %v", err)
	}
	return entries
}

func onlyObject(t *testing.T, s *versionSide, remote string) rclonefs.Object {
	t.Helper()
	obj, err := s.fs.NewObject(context.Background(), remote)
	if err != nil {
		t.Fatalf("find %s: %v", remote, err)
	}
	return obj
}

// A caller that forgot to say must not destroy anybody's files.
func TestADeletionGoesToTheTrashWhenNobodySaidOtherwise(t *testing.T) {
	s := newVersionSide(t)
	s.write(t, "docs/notes.txt", "worth keeping")

	// A plain context: no caller said anything about a trash.
	if err := discard(context.Background(), s.fs, onlyObject(t, s, "docs/notes.txt"), "20260909-101500"); err != nil {
		t.Fatalf("discard: %v", err)
	}

	if _, alive := s.read(t, "docs/notes.txt"); alive {
		t.Error("the file is still in its old place")
	}
	kept := binned(t, s)
	if len(kept) != 1 || kept[0].Path != "docs/notes.txt" {
		t.Fatalf("expected the file in the trash, got %+v", kept)
	}
}

// The reserved directory must not be created at all, not merely left empty.
func TestATrashlessJobLeavesNoReservedFolderBehind(t *testing.T) {
	s := newVersionSide(t)
	s.write(t, "docs/notes.txt", "not worth keeping")

	ctx := WithTrash(context.Background(), false)
	if err := discard(ctx, s.fs, onlyObject(t, s, "docs/notes.txt"), "20260909-101500"); err != nil {
		t.Fatalf("discard: %v", err)
	}

	if _, alive := s.read(t, "docs/notes.txt"); alive {
		t.Error("the file is still there")
	}
	if kept := binned(t, s); len(kept) != 0 {
		t.Errorf("a job with no trash filed %d things in one: %+v", len(kept), kept)
	}
	if _, err := os.Stat(filepath.Join(s.root, filepath.FromSlash(scan.MetaDir))); !os.IsNotExist(err) {
		t.Errorf("the reserved folder exists on a side whose job asked for no trash: %v", err)
	}
}

func TestSayingYesExplicitlyStillKeepsATrash(t *testing.T) {
	s := newVersionSide(t)
	s.write(t, "docs/notes.txt", "worth keeping")

	ctx := WithTrash(context.Background(), true)
	if err := discard(ctx, s.fs, onlyObject(t, s, "docs/notes.txt"), "20260909-101500"); err != nil {
		t.Fatalf("discard: %v", err)
	}
	if kept := binned(t, s); len(kept) != 1 {
		t.Fatalf("expected one thing in the trash, got %+v", kept)
	}
}
