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

// The switch behind jdp's question about the reserved folder: "braucht es den
// .arrowloop ordner im Zielordner? Kann man den nicht weglassen?"
//
// Driven through discard rather than through Run, which is where the deletion
// path actually goes; the daemon's own tests cover the wiring from a job's
// configuration down to here, because a setting that is never read is the
// failure this pair cannot see.

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

// TestADeletionGoesToTheTrashWhenNobodySaidOtherwise.
//
// The default has to be this way round, and it is the opposite of the version
// setting's default. An unset version count means "keep none", which loses
// nothing that was not already being overwritten. An unset trash setting must
// mean "keep one", because the alternative is that a caller who forgot to say
// destroys somebody's files.
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

// TestATrashlessJobLeavesNoReservedFolderBehind is the whole point of the
// switch. Not merely "the file is gone", which an empty trash folder would also
// produce, but that the reserved directory was never created at all - because
// the folder appearing in a shared download share is the thing that was
// reported.
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

// TestSayingYesExplicitlyStillKeepsATrash, so that the switch is a switch and
// not a one-way door: `WithTrash(ctx, true)` has to behave like the default
// rather than like whatever the last caller set.
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
