//go:build windows

package apply_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"golang.org/x/sys/windows"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// Locking is mandatory on Windows and advisory on POSIX, so these states only
// exist on Windows.

// The source is known to be locked before the transfer, so no attempt is made.
func TestALockedSourceIsPostponedBeforeItIsAttempted(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit made while the document is open")
	defer lockFile(t, filepath.Join(j.left, "notes.txt"))()

	skip := runAndFindSkip(t, j, "notes.txt")
	if skip.Reason.Code != "heldOpen" {
		t.Errorf("a locked source was postponed as %q (%s), wanted heldOpen", skip.Reason.Code, skip.Reason.Text)
	}
	if skip.Reason.Vars["side"] != "left" {
		t.Errorf("the reason names the %q side, and the lock is on the left", skip.Reason.Vars["side"])
	}
	if got := readOrEmpty(t, filepath.Join(j.right, "notes.txt")); got != "the original" {
		t.Errorf("the far side holds %q, so the locked file was copied after all", got)
	}
}

// The destination is not probed beforehand, so the run meets its lock by
// failing on it.
func TestALockedDestinationIsRecordedAsHeldOpenNotAsAFailure(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit that has to travel")
	defer lockFile(t, filepath.Join(j.right, "notes.txt"))()

	skip := runAndFindSkip(t, j, "notes.txt")
	if skip.Reason.Code != "heldOpenDuring" {
		t.Errorf("a locked destination was recorded as %q (%s), wanted heldOpenDuring", skip.Reason.Code, skip.Reason.Text)
	}
	// The backend's own words are the only place the reader learns which
	// operation died.
	if skip.Reason.Vars["error"] == "" {
		t.Error("the reason dropped the backend's own words, leaving nothing to search for")
	}
}

// A rename is applied on the far side, over a file that side is holding, in its
// own pass before any copy.
func TestALockedRenameIsPostponedRatherThanAttempted(t *testing.T) {
	j := newLockJob(t)
	// The same content under a new name, which the engine matches by checksum
	// as a rename.
	if err := os.Rename(filepath.Join(j.left, "notes.txt"), filepath.Join(j.left, "renamed.txt")); err != nil {
		t.Fatalf("rename: %v", err)
	}
	defer lockFile(t, filepath.Join(j.right, "notes.txt"))()

	skip := runAndFindSkip(t, j, "renamed.txt")
	// heldOpen, not heldOpenDuring: accepting either would let the probe be
	// dropped from the rename pass without anything noticing.
	if skip.Reason.Code != "heldOpen" {
		t.Errorf("a rename onto a held file was recorded as %q (%s), wanted heldOpen before it was tried", skip.Reason.Code, skip.Reason.Text)
	}
	if skip.Reason.Vars["side"] != "right" {
		t.Errorf("the reason names the %q side, and the far side is the one holding the file", skip.Reason.Vars["side"])
	}
	// A rename reported as postponed that had happened would leave the record
	// and the disk disagreeing.
	if _, err := os.Stat(filepath.Join(j.right, "notes.txt")); err != nil {
		t.Errorf("the far side lost the file the run said it had left alone: %v", err)
	}
}

// The outcome has to be in the run's list, not only in a counter.
func TestALockedFileReachesTheRunsOwnList(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit made while the document is open")
	defer lockFile(t, filepath.Join(j.left, "notes.txt"))()

	res := runJob(t, j)
	var found bool
	for _, e := range res.Entries {
		if e.Path != "notes.txt" || e.Kind != "skip" {
			continue
		}
		found = true
		if e.Note == "" {
			t.Error("the run's list names the file and says nothing about why it was left")
		}
	}
	if !found {
		t.Errorf("the locked file is not in the run's list at all: %+v", res.Entries)
	}
	// A skip is work postponed, not done on a side.
	for _, e := range res.Entries {
		if e.Kind == "skip" && e.Side != "" {
			t.Errorf("a skip was recorded as though it had happened on a side: %+v", e)
		}
	}
}

type lockJob struct {
	left, right string
	ends        apply.Ends
	db          *state.DB
	opt         engine.Options
}

// newLockJob builds two sides that already agree about one file, so that the
// next run has exactly one piece of work to do and the test can be sure which
// file a skip is about.
func newLockJob(t *testing.T) *lockJob {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	leftFs, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left fs: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right fs: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	j := &lockJob{
		left: left, right: right,
		ends: apply.Ends{Left: leftFs, Right: rightFs},
		db:   db,
		// No quiet period, which would postpone the freshly written files
		// for a reason of its own.
		opt: engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second}},
	}

	writeTo(t, left, "notes.txt", "the original")
	if _, _, err := engine.Once(ctx, j.ends, j.db, j.opt); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	return j
}

func runJob(t *testing.T, j *lockJob) apply.Result {
	t.Helper()
	_, res, err := engine.Once(context.Background(), j.ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return res
}

func runAndFindSkip(t *testing.T, j *lockJob, path string) plan.Skip {
	t.Helper()
	res := runJob(t, j)
	for _, s := range res.Skipped {
		if s.Path == path {
			return s
		}
	}
	t.Fatalf("%q was not postponed at all: skipped %+v, entries %+v", path, res.Skipped, res.Entries)
	return plan.Skip{}
}

// lockFile opens a file with share mode zero, as a program keeping it to itself
// does, and returns the release. A Go os.Open handle allows sharing and would
// not lock anything.
func lockFile(t *testing.T, path string) func() {
	t.Helper()
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatalf("path %s: %v", path, err)
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatalf("could not lock %s, so this test would prove nothing: %v", path, err)
	}
	// Released before the temporary directory is cleaned up, which would
	// otherwise fail on the lock.
	return func() { windows.CloseHandle(h) }
}

func writeTo(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", rel, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

func readOrEmpty(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(data)
}
