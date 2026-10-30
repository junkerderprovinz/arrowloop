package scenario

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/fserrors"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// shutOut answers a listing of one folder the way the local backend answers
// for a folder the process may not open: as empty, with the error only
// counted.
type shutOut struct {
	rclonefs.Fs
	dir string
}

func (s shutOut) List(ctx context.Context, dir string) (rclonefs.DirEntries, error) {
	if dir == s.dir {
		err := fmt.Errorf("failed to open directory %q: %w", dir, &os.PathError{Op: "open", Path: dir, Err: os.ErrPermission})
		_ = accounting.Stats(ctx).Error(fserrors.NoRetryError(err))
		return nil, nil
	}
	return s.Fs.List(ctx, dir)
}

// vanishing deletes one folder just before the walk opens it, as a program
// clearing out its temporary folder does.
type vanishing struct {
	rclonefs.Fs
	root string
	dir  string
}

func (v vanishing) List(ctx context.Context, dir string) (rclonefs.DirEntries, error) {
	if dir == v.dir {
		if err := os.RemoveAll(filepath.Join(v.root, filepath.FromSlash(dir))); err != nil {
			return nil, err
		}
	}
	return v.Fs.List(ctx, dir)
}

// mirrored is a mirror from left to right that has synced a folder once and
// since gained a file and an empty folder in it that only the destination
// holds. A mirror that took the folder for empty would remove all of them.
func mirrored(t *testing.T) *directed {
	t.Helper()
	j := oneWay(t, plan.LeftToRight)
	j.opt.Compare.Mode = plan.ModeMirror
	j.opt.EmptyDirs = true
	write(t, j.left, "keep.txt", "keep")
	write(t, j.left, "tmp/held.txt", "held")
	j.run(t)

	write(t, j.right, "tmp/only-here.txt", "only on the destination")
	if err := os.MkdirAll(filepath.Join(j.right, "tmp", "empty"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, j.left, "new.txt", "new")
	return j
}

// leftAlone checks that a run passed over tmp for the given reason, left
// everything under it on the destination and still did the rest.
func leftAlone(t *testing.T, j *directed, res apply.Result, code string) {
	t.Helper()
	for _, rel := range []string{"tmp/held.txt", "tmp/only-here.txt", "new.txt"} {
		if _, err := os.Stat(filepath.Join(j.right, filepath.FromSlash(rel))); err != nil {
			t.Errorf("%s is missing on the destination: %v", rel, err)
		}
	}
	if _, err := os.Stat(filepath.Join(j.right, "tmp", "empty")); err != nil {
		t.Errorf("the empty folder went from the destination: %v", err)
	}
	if res.Trashed != 0 || res.DirsRemoved != 0 {
		t.Errorf("the run removed %d files and %d folders", res.Trashed, res.DirsRemoved)
	}
	if len(res.Skipped) != 1 || res.Skipped[0].Path != "tmp" || res.Skipped[0].Reason.Code != code {
		t.Fatalf("skipped %v, want tmp as %s", res.Skipped, code)
	}
	want := apply.Entry{Kind: "skip", Side: "left", Path: "tmp", Note: code}
	if !hasEntry(res.Entries, want) {
		t.Errorf("the run log %v does not name the folder as %+v", res.Entries, want)
	}
	// The row is what lets a later run tell a deletion from a file it could
	// not see.
	if _, ok, err := j.db.Get(context.Background(), "tmp/held.txt"); err != nil || !ok {
		t.Errorf("the record lost tmp/held.txt: %v", err)
	}
}

func hasEntry(entries []apply.Entry, want apply.Entry) bool {
	for _, e := range entries {
		if e == want {
			return true
		}
	}
	return false
}

func TestMirrorLeavesAFolderTheSourceMayNotOpenAloneOnBothSides(t *testing.T) {
	j := mirrored(t)
	j.ends.Left = shutOut{Fs: j.ends.Left, dir: "tmp"}
	_, res := j.run(t)
	leftAlone(t, j, res, "unreadable")
}

func TestMirrorLeavesAFolderThatVanishedWhileBeingReadAlone(t *testing.T) {
	j := mirrored(t)
	j.ends.Left = vanishing{Fs: j.ends.Left, root: j.left, dir: "tmp"}
	_, res := j.run(t)
	leftAlone(t, j, res, "vanished")
}

// Nothing is written into a folder the destination may not open either, and
// what the source holds there waits for a run that can compare it.
func TestMirrorCopiesNothingIntoAFolderTheDestinationMayNotOpen(t *testing.T) {
	j := mirrored(t)
	write(t, j.left, "tmp/later.txt", "later")
	j.ends.Right = shutOut{Fs: j.ends.Right, dir: "tmp"}
	_, res := j.run(t)
	if _, err := os.Stat(filepath.Join(j.right, "tmp", "later.txt")); err == nil {
		t.Error("a file was copied into the folder the destination could not read")
	}
	if len(res.Skipped) != 1 || res.Skipped[0].Reason.Vars["side"] != "right" {
		t.Errorf("skipped %v, want tmp on the right", res.Skipped)
	}
}

// A two-way job carries a deletion to the other side, so a folder one side
// could not read must not look like one whose files were deleted there.
func TestTwoWayCarriesNoDeletionOutOfAFolderOneSideCouldNotRead(t *testing.T) {
	for _, side := range []plan.Side{plan.Left, plan.Right} {
		t.Run(side.String(), func(t *testing.T) {
			j := newJob(t, quick())
			write(t, j.left, "keep.txt", "keep")
			write(t, j.left, "tmp/held.txt", "held")
			write(t, j.left, "tmp/deep/more.txt", "more")
			j.sync(t)

			readable := j.ends
			roots := map[plan.Side]string{plan.Left: j.left, plan.Right: j.right}
			write(t, roots[side.Other()], "tmp/new-there.txt", "new on the readable side")
			if side == plan.Left {
				j.ends.Left = shutOut{Fs: j.ends.Left, dir: "tmp"}
			} else {
				j.ends.Right = shutOut{Fs: j.ends.Right, dir: "tmp"}
			}

			_, res := j.sync(t)
			for _, root := range roots {
				for _, rel := range []string{"tmp/held.txt", "tmp/deep/more.txt"} {
					if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
						t.Errorf("%s went from %s: %v", rel, root, err)
					}
				}
			}
			if _, err := os.Stat(filepath.Join(roots[side], "tmp", "new-there.txt")); err == nil {
				t.Error("a file was copied into the folder that could not be read")
			}
			if res.Trashed != 0 || res.Copied != 0 {
				t.Errorf("the run copied %d and trashed %d files", res.Copied, res.Trashed)
			}
			if len(res.Skipped) != 1 || res.Skipped[0].Reason.Vars["side"] != side.String() {
				t.Fatalf("skipped %v, want tmp on the %s", res.Skipped, side)
			}
			// Missing from both listings, the files would read as gone on both
			// sides and lose their rows.
			if _, ok, err := j.db.Get(context.Background(), "tmp/held.txt"); err != nil || !ok {
				t.Errorf("the record lost tmp/held.txt: %v", err)
			}

			// Once the folder opens again the run picks up where it left off.
			j.ends = readable
			if _, res := j.sync(t); res.Trashed != 0 || res.Copied != 1 {
				t.Errorf("the next run copied %d and trashed %d files, want one copy", res.Copied, res.Trashed)
			}
			requireConverged(t, j, "after the folder could be read again")
		})
	}
}

// A row for a folder nobody could read is neither dropped nor counted against
// the brakes, which measure what a run would delete.
func TestAnUnreadFolderDoesNotTripTheBrakes(t *testing.T) {
	j := newJob(t, guarded())
	write(t, j.left, "keep.txt", "keep")
	for i := range 20 {
		write(t, j.left, fmt.Sprintf("tmp/%02d.txt", i), "held")
	}
	j.sync(t)

	j.ends.Left = shutOut{Fs: j.ends.Left, dir: "tmp"}
	if _, res := j.sync(t); res.Trashed != 0 {
		t.Fatalf("trashed %d files", res.Trashed)
	}
	rows, err := j.db.All(context.Background())
	if err != nil {
		t.Fatalf("record: %v", err)
	}
	if len(rows) != 21 {
		t.Fatalf("the record holds %d rows, want 21", len(rows))
	}
}
