//go:build windows

package apply_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/shadow"
)

// frozen stands in for a shadow copy: a directory holding the side as it was
// when the copy was taken.
type frozen struct {
	dir string
	err error
}

func (f frozen) Root(context.Context, string) (string, error) { return f.dir, f.err }

// freeze copies one file of a side into a snapshot directory, modification
// time included, as a shadow copy would show it.
func freeze(t *testing.T, side, rel string) string {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(side, rel)
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, rel)
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(dst, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	return dir
}

func runWith(t *testing.T, j *lockJob, s apply.Snapshots) apply.Result {
	t.Helper()
	_, res, err := engine.Once(apply.WithSnapshots(context.Background(), s), j.ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return res
}

func TestALockedSourceIsCopiedFromASnapshot(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit made while the document is open")
	snap := frozen{dir: freeze(t, j.left, "notes.txt")}
	defer lockFile(t, filepath.Join(j.left, "notes.txt"))()

	res := runWith(t, j, snap)
	for _, s := range res.Skipped {
		t.Errorf("%s was postponed (%s) although a snapshot could be read", s.Path, s.Reason.Text)
	}
	if got := readOrEmpty(t, filepath.Join(j.right, "notes.txt")); got != "an edit made while the document is open" {
		t.Errorf("the far side holds %q, want the edit read from the snapshot", got)
	}

	// The record matches the live file, which did not change after the
	// snapshot, so the next run has nothing to do.
	again := runWith(t, j, snap)
	if again.Copied != 0 || len(again.Skipped) != 0 {
		t.Errorf("the next run copied %d and postponed %d, want nothing", again.Copied, len(again.Skipped))
	}
}

func TestWithoutAdministratorRightsTheReasonSaysWhatWouldCopyIt(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit made while the document is open")
	defer lockFile(t, filepath.Join(j.left, "notes.txt"))()

	res := runWith(t, j, frozen{err: shadow.ErrNeedsAdmin})
	if len(res.Skipped) != 1 || res.Skipped[0].Reason.Code != "heldOpenAdmin" {
		t.Fatalf("skipped %+v, want the file postponed as heldOpenAdmin", res.Skipped)
	}
}

func TestAFailedSnapshotIsReportedWithItsError(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit made while the document is open")
	defer lockFile(t, filepath.Join(j.left, "notes.txt"))()

	res := runWith(t, j, frozen{err: errors.New("the volume has no room for a shadow copy")})
	if len(res.Skipped) != 1 {
		t.Fatalf("skipped %+v, want one file", res.Skipped)
	}
	r := res.Skipped[0].Reason
	if r.Code != "snapshotFailed" || r.Vars["error"] != "the volume has no room for a shadow copy" {
		t.Errorf("postponed as %q with %q, want snapshotFailed with the snapshot's own error", r.Code, r.Vars["error"])
	}
}

// The whole way through a real shadow copy and rclone's local backend, which
// has to accept the device path the copy is read through.
func TestALockedSourceIsCopiedFromARealShadowCopy(t *testing.T) {
	if !windows.GetCurrentProcessToken().IsElevated() {
		t.Skip("taking a shadow copy needs administrator rights")
	}
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit made while the document is open")
	defer lockFile(t, filepath.Join(j.left, "notes.txt"))()

	shots := shadow.New()
	defer shots.Close(context.Background())
	res := runWith(t, j, shots)
	for _, s := range res.Skipped {
		t.Errorf("%s was postponed: %s", s.Path, s.Reason.Text)
	}
	if got := readOrEmpty(t, filepath.Join(j.right, "notes.txt")); got != "an edit made while the document is open" {
		t.Errorf("the far side holds %q, want the edit read from the shadow copy", got)
	}
}
