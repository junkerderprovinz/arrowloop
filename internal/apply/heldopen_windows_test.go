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

// A file somebody has open is the single most common thing that goes wrong on a
// Windows sync, and it is not a fault: the remedy is to close a window, and the
// next run picks the file up. These two tests are the difference between a run
// that says so and a run that files it beside a full disk.
//
// Windows only, and not by omission. Locking is mandatory there and advisory on
// POSIX, so the state under test cannot be reached at all on Linux or macOS.

// TestALockedSourceIsPostponedBeforeItIsAttempted covers the probe that runs
// before a transfer: the file is known to be locked, so no attempt is made.
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
	// Nothing may have travelled. A skip that copied the file anyway would be
	// reporting a postponement it did not make.
	if got := readOrEmpty(t, filepath.Join(j.right, "notes.txt")); got != "the original" {
		t.Errorf("the far side holds %q, so the locked file was copied after all", got)
	}
}

// TestALockedDestinationIsRecordedAsHeldOpenNotAsAFailure covers the half the
// probe cannot reach.
//
// The destination is deliberately not probed, and a lock can be taken in the
// moment between any probe and the transfer, so the everyday way a run meets a
// locked file is by failing on it. Before this, that failure was recorded under
// the generic step-failed reason with a localised Win32 sentence attached, in
// the same list as a full disk and a refused permission.
func TestALockedDestinationIsRecordedAsHeldOpenNotAsAFailure(t *testing.T) {
	j := newLockJob(t)
	writeTo(t, j.left, "notes.txt", "an edit that has to travel")
	defer lockFile(t, filepath.Join(j.right, "notes.txt"))()

	skip := runAndFindSkip(t, j, "notes.txt")
	if skip.Reason.Code != "heldOpenDuring" {
		t.Errorf("a locked destination was recorded as %q (%s), wanted heldOpenDuring", skip.Reason.Code, skip.Reason.Text)
	}
	// The backend's own words are kept. They are localised and unreliable as a
	// thing to match on, and they are still the only place the reader learns
	// which operation died.
	if skip.Reason.Vars["error"] == "" {
		t.Error("the reason dropped the backend's own words, leaving nothing to search for")
	}
}

// TestALockedRenameIsPostponedRatherThanAttempted covers the kind of work the
// probe used to walk straight past.
//
// A rename is applied on the FAR side, over a file that side is holding, and
// renames run in their own sequential pass before any copy. Nothing in that
// pass asked whether the file was free, so renaming a folder of documents while
// one of them was open reported a raw Win32 sentence under the generic failure
// reason.
func TestALockedRenameIsPostponedRatherThanAttempted(t *testing.T) {
	j := newLockJob(t)
	// The same content under a new name, which is what makes this a rename
	// rather than a delete and a copy: the engine matches the two by checksum.
	if err := os.Rename(filepath.Join(j.left, "notes.txt"), filepath.Join(j.left, "renamed.txt")); err != nil {
		t.Fatalf("rename: %v", err)
	}
	defer lockFile(t, filepath.Join(j.right, "notes.txt"))()

	skip := runAndFindSkip(t, j, "renamed.txt")
	// heldOpen and not heldOpenDuring, deliberately. The rename is never
	// attempted: the pass asks first. Accepting either code here would let the
	// probe be taken out of the rename pass entirely without anything noticing,
	// because the failure would then be classified after the fact and read
	// almost the same in the report.
	if skip.Reason.Code != "heldOpen" {
		t.Errorf("a rename onto a held file was recorded as %q (%s), wanted heldOpen before it was tried", skip.Reason.Code, skip.Reason.Text)
	}
	if skip.Reason.Vars["side"] != "right" {
		t.Errorf("the reason names the %q side, and the far side is the one holding the file", skip.Reason.Vars["side"])
	}
	// The far side still holds the old name. A rename reported as postponed
	// that had in fact happened would leave the record and the disk disagreeing.
	if _, err := os.Stat(filepath.Join(j.right, "notes.txt")); err != nil {
		t.Errorf("the far side lost the file the run said it had left alone: %v", err)
	}
}

// TestALockedFileReachesTheRunsOwnList is the point of both: the outcome has to
// be in the record the daemon writes down, not only in a counter.
//
// The count answers "how much" and nobody has that question afterwards. A run
// reporting "1 skipped" and nothing else is why this list exists.
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
	// A skip is work postponed, not work done, and moving the bar for one
	// would walk it past its own total on a run where several files are open.
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
		// No quiet period. The files here are written and then immediately
		// synced, and the settling rule would postpone every one of them for
		// its own perfectly good reason, hiding the reason under test.
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

// lockFile takes the kind of lock a program holds when it means to keep a file
// to itself, and returns the release.
//
// Share mode zero rather than a Go os.Open handle, because a Go handle asks for
// read and write sharing and would not stop anything. This is the situation, not
// an imitation of it.
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
	// Released before the temporary directory is cleaned up, or the cleanup
	// itself fails on the lock and the failure is reported against whichever
	// test ran next.
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
