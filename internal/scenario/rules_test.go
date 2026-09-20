package scenario

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// The same name as macOS (decomposed) and Windows and Linux (composed) store
// it.
const (
	composed   = "Müller.txt"  // one code point for the umlaut, as Windows and Linux store it
	decomposed = "Müller.txt" // u plus a combining diaeresis, as macOS stores it
)

// Without normalisation each spelling would be copied across on every run.
func TestUnicodeSpellingIsOneFile(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, composed, "the same content")
	write(t, j.right, decomposed, "the same content")

	for round := range 3 {
		p, res := j.sync(t)
		if res.Copied != 0 || res.Trashed != 0 || res.Conflicts != 0 {
			t.Fatalf("round %d: the two spellings were treated as different files (%d copied, %d trashed, %d conflicts)",
				round, res.Copied, res.Trashed, res.Conflicts)
		}
		if len(p.Actions) != 0 {
			t.Fatalf("round %d: expected no work, got %d actions", round, len(p.Actions))
		}
		if got := len(tree(t, j.left)); got != 1 {
			t.Fatalf("round %d: the left side now holds %d files, want 1", round, got)
		}
		if got := len(tree(t, j.right)); got != 1 {
			t.Fatalf("round %d: the right side now holds %d files, want 1", round, got)
		}
	}
}

// A newly excluded path must not read as a deletion.
func TestExcludingDoesNotDelete(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "keep.txt", "keep me")
	write(t, j.left, "logs/noisy.log", "noise")
	j.sync(t)
	requireConverged(t, j, "after the first run")

	excl, err := filter.New([]string{"*.log"})
	if err != nil {
		t.Fatalf("filter: %v", err)
	}
	j.opt.Exclude = excl

	p, res := j.sync(t)
	if res.Trashed != 0 || len(p.Actions) != 0 {
		t.Fatalf("excluding a synced file produced work: %d trashed, %d actions", res.Trashed, len(p.Actions))
	}
	for _, side := range []string{j.left, j.right} {
		if _, err := os.Stat(filepath.Join(side, "logs", "noisy.log")); err != nil {
			t.Errorf("the newly excluded file was destroyed on %s: %v", side, err)
		}
	}
}

func TestDefaultExcludesSkipHalfWrittenFiles(t *testing.T) {
	excl, err := filter.New(filter.InProgress)
	if err != nil {
		t.Fatalf("filter: %v", err)
	}
	j := newJob(t, quick())
	j.opt.Exclude = excl

	write(t, j.left, "report.docx", "a real document")
	write(t, j.left, "~$report.docx", "office owner file")
	write(t, j.left, "movie.mkv.part", "a half-finished download")
	write(t, j.left, "notes/scratch.tmp", "temporary")

	j.sync(t)

	got := tree(t, j.right)
	if len(got) != 1 {
		t.Fatalf("expected only the real document to cross, got %v", keys(got))
	}
	if _, ok := got["report.docx"]; !ok {
		t.Errorf("the real document did not cross: %v", keys(got))
	}
}

// The clock is injected so the test does not have to wait out the period.
func TestQuietPeriodPostponesAFreshFile(t *testing.T) {
	opt := quick()
	opt.Compare.QuietPeriod = time.Hour
	opt.Compare.Now = time.Now()
	j := newJob(t, opt)

	write(t, j.left, "being-saved.docx", "half of a document")

	p, res := j.sync(t)
	if res.Copied != 0 {
		t.Fatalf("a file written moments ago was copied anyway")
	}
	if len(p.Skipped) != 1 {
		t.Fatalf("expected the fresh file to be postponed, got %d skips", len(p.Skipped))
	}
	if len(tree(t, j.right)) != 0 {
		t.Fatal("the half-written file reached the other side")
	}

	// The skip wrote no state row, so waiting is enough.
	j.opt.Compare.Now = time.Now().Add(2 * time.Hour)
	_, res = j.sync(t)
	if res.Copied != 1 {
		t.Fatalf("once settled the file should copy exactly once, got %d", res.Copied)
	}
	requireConverged(t, j, "after the file settled")
}

// On a case-insensitive side one of the two files would silently overwrite
// the other.
func TestCaseCollisionIsRefused(t *testing.T) {
	fold := true
	opt := quick()
	opt.ForceFoldCase = &fold
	j := newJob(t, opt)

	write(t, j.left, "Bild.jpg", "the first photo")
	write(t, j.left, "bild.jpg", "a different photo")
	write(t, j.left, "safe.txt", "no trouble here")

	if len(tree(t, j.left)) != 3 {
		// Windows and macOS fold the two names into one file. Linux must
		// not, or the test would skip everywhere.
		if runtime.GOOS == "linux" {
			t.Fatal("the two names did not survive on a case-sensitive filesystem, so this test is no longer testing the collision path")
		}
		t.Skip("this filesystem cannot hold two names differing only in case, so there is nothing to collide")
	}

	p, res := j.sync(t)
	if len(p.Skipped) != 1 {
		t.Fatalf("expected exactly one collision report, got %d: %+v", len(p.Skipped), p.Skipped)
	}
	if res.Copied != 1 {
		t.Fatalf("the unaffected file should still have synced, got %d copies", res.Copied)
	}

	got := tree(t, j.right)
	if len(got) != 1 {
		t.Fatalf("a colliding file was synced anyway: %v", keys(got))
	}
	if _, ok := got["safe.txt"]; !ok {
		t.Errorf("the wrong file crossed: %v", keys(got))
	}
}

func TestReservedDirectoryNeverTravels(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, scan.TrashDir+"/old/deleted.txt", "a previously deleted file")
	write(t, j.left, "real.txt", "user data")

	_, res := j.sync(t)
	if res.Copied != 1 {
		t.Fatalf("expected only the real file to copy, got %d", res.Copied)
	}
	if _, err := os.Stat(filepath.Join(j.right, filepath.FromSlash(scan.TrashDir))); !os.IsNotExist(err) {
		t.Error("the trash was synced to the other side")
	}
}

func TestSkippedWorkLeavesTheRecordAlone(t *testing.T) {
	opt := quick()
	opt.Compare.QuietPeriod = time.Hour
	opt.Compare.Now = time.Now()
	j := newJob(t, opt)
	write(t, j.left, "fresh.txt", "written just now")

	if _, _, err := engine.Once(context.Background(), j.ends, j.db, j.opt); err != nil {
		t.Fatalf("sync: %v", err)
	}
	rows, err := j.db.All(context.Background())
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("a postponed file was recorded as agreed: %+v", rows)
	}
}

// A job pointed at nothing lists no files, like a job with nothing to do, but
// must not report success.
func TestAJobWithNothingToWorkWithIsRefused(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	// Like an unmounted share or a mistyped folder.
	missing := filepath.Join(root, "not-here")
	right := filepath.Join(root, "right")
	if err := os.MkdirAll(right, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	leftFs, err := rclonefs.NewFs(ctx, missing)
	if err != nil {
		t.Fatalf("left: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()

	ends := apply.Ends{Left: leftFs, Right: rightFs}
	opt := engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Transfers: 4}}

	_, _, err = engine.Prepare(ctx, ends, db, opt)
	var nothing *engine.NothingToSyncError
	if !errors.As(err, &nothing) {
		t.Fatalf("a job pointed at a folder that does not exist reported %v", err)
	}

	// The refusal has to name the path to look at.
	if !strings.Contains(err.Error(), "not-here") {
		t.Errorf("the refusal does not name the side that is missing: %v", err)
	}

	// With one file it is an ordinary first run.
	if err := os.MkdirAll(missing, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(missing, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, _, err := engine.Once(ctx, ends, db, opt); err != nil {
		t.Fatalf("an ordinary first run was refused: %v", err)
	}

	// A folder holding only excluded files lists nothing either, but it
	// exists.
	fresh := t.TempDir()
	onlyExcluded := filepath.Join(fresh, "left")
	otherSide := filepath.Join(fresh, "right")
	for _, d := range []string{onlyExcluded, otherSide} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(onlyExcluded, "draft.tmp"), []byte("half written"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	freshLeft, err := rclonefs.NewFs(ctx, onlyExcluded)
	if err != nil {
		t.Fatalf("left: %v", err)
	}
	freshRight, err := rclonefs.NewFs(ctx, otherSide)
	if err != nil {
		t.Fatalf("right: %v", err)
	}
	freshDB, err := state.Open(ctx, filepath.Join(fresh, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer freshDB.Close()

	excludes, err := filter.New(filter.InProgress)
	if err != nil {
		t.Fatalf("build the excludes: %v", err)
	}
	freshOpt := opt
	freshOpt.Exclude = excludes
	if _, _, err := engine.Once(ctx, apply.Ends{Left: freshLeft, Right: freshRight}, freshDB, freshOpt); err != nil {
		t.Fatalf("a folder holding only excluded files was reported as a path that does not exist: %v", err)
	}
}

// A side that vanished gets the empty-side refusal, which says how many files
// were known there, rather than the one for a path that never existed.
func TestAVanishedSideIsNamedByItsRecord(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	for i := range 4 {
		if err := os.WriteFile(filepath.Join(left, fmt.Sprintf("file%d.txt", i)), []byte("content"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	leftFs, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()

	ends := apply.Ends{Left: leftFs, Right: rightFs}
	opt := engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Transfers: 4}}
	if _, _, err := engine.Once(ctx, ends, db, opt); err != nil {
		t.Fatalf("the first run failed: %v", err)
	}

	// The drive is pulled out.
	if err := os.RemoveAll(left); err != nil {
		t.Fatalf("remove: %v", err)
	}

	_, _, err = engine.Prepare(ctx, ends, db, opt)
	var empty *plan.EmptySideError
	var nothing *engine.NothingToSyncError
	switch {
	case errors.As(err, &empty):
		if !strings.Contains(err.Error(), "4") {
			t.Errorf("the refusal does not say how many files were known: %v", err)
		}
	case errors.As(err, &nothing):
		t.Fatalf("a side that vanished was reported as a path that never existed, "+
			"which sends its owner to check a spelling instead of a mount: %v", err)
	default:
		t.Fatalf("a vanished side was not refused at all: %v", err)
	}

	// Both sides gone, as with one unmounted share holding both.
	if err := os.RemoveAll(right); err != nil {
		t.Fatalf("remove: %v", err)
	}
	_, _, err = engine.Prepare(ctx, ends, db, opt)
	if errors.As(err, &nothing) {
		t.Fatalf("a job whose whole share went away lost the fact that it knew about four files: %v", err)
	}
	if !errors.As(err, &empty) {
		t.Fatalf("both sides vanishing was not refused by the record: %v", err)
	}
}

// A resolution picked by a person leaves the chosen version on both sides
// under the plain name, with the other one recoverable from the trash.
func TestAChosenConflictKeepsOneVersionAndBinsTheOther(t *testing.T) {
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
		t.Fatalf("left: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()

	ends := apply.Ends{Left: leftFs, Right: rightFs}
	opt := engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Transfers: 4}}

	if err := os.WriteFile(filepath.Join(left, "notes.txt"), []byte("the original"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, _, err := engine.Once(ctx, ends, db, opt); err != nil {
		t.Fatalf("first run: %v", err)
	}

	// The left version is the older one, so choosing it differs from what the
	// automatic rule would do.
	if err := os.WriteFile(filepath.Join(left, "notes.txt"), []byte("the version I want"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(right, "notes.txt"), []byte("the newer version"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	p, compare, err := engine.Prepare(ctx, ends, db, opt)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	var conflicts int
	for i := range p.Actions {
		if p.Actions[i].Kind == plan.Conflict {
			p.Actions[i].Resolve = plan.KeepLeft
			conflicts++
		}
	}
	if conflicts != 1 {
		t.Fatalf("expected one conflict to decide, found %d", conflicts)
	}
	if _, err := engine.Execute(ctx, ends, db, p, compare); err != nil {
		t.Fatalf("execute: %v", err)
	}

	for _, dir := range []string{left, right} {
		body, err := os.ReadFile(filepath.Join(dir, "notes.txt"))
		if err != nil {
			t.Fatalf("read %s: %v", dir, err)
		}
		if string(body) != "the version I want" {
			t.Errorf("%s holds %q, not the version that was chosen", dir, body)
		}
	}

	entries, err := os.ReadDir(right)
	if err != nil {
		t.Fatalf("read the right side: %v", err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), "conflict") {
			t.Errorf("a chosen resolution still left %s behind", e.Name())
		}
	}

	var rescued bool
	err = filepath.WalkDir(right, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if !strings.Contains(filepath.ToSlash(p), ".arrowloop/trash") {
			return nil
		}
		body, readErr := os.ReadFile(p)
		if readErr == nil && string(body) == "the newer version" {
			rescued = true
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if !rescued {
		t.Error("the version that was not chosen is gone rather than in the trash")
	}

	after, _, err := engine.Prepare(ctx, ends, db, opt)
	if err != nil {
		t.Fatalf("second prepare: %v", err)
	}
	if len(after.Actions) != 0 {
		t.Fatalf("the chosen resolution did not settle: %d actions left", len(after.Actions))
	}
}
