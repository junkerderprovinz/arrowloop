package scenario

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/junkerderprovinz/reeveroll/internal/engine"
	"github.com/junkerderprovinz/reeveroll/internal/filter"
	"github.com/junkerderprovinz/reeveroll/internal/scan"
)

// The same name, spelled the two ways real filesystems spell it. macOS stores
// the decomposed form, Windows and Linux the composed one.
const (
	composed   = "Müller.txt"  // one code point for the umlaut, as Windows and Linux store it
	decomposed = "Müller.txt" // u plus a combining diaeresis, as macOS stores it
)

// TestUnicodeSpellingIsOneFile is the endless-loop test.
//
// Without normalisation the engine sees a file that exists only on the left and
// a different file that exists only on the right, copies each one across, and
// does it again on the next run. The tree grows by two files every time and
// never settles. Counting files after three runs is the whole assertion.
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

// TestExcludingDoesNotDelete guards the trap that makes filters dangerous.
//
// A path that stops being visible has not been deleted. An engine that simply
// drops excluded paths from the listing reads the disappearance as a deletion
// and removes the file on the other side, so adding one pattern would wipe
// every file it starts hiding. The record has to be filtered as well.
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

// TestDefaultExcludesSkipHalfWrittenFiles proves the in-progress names never
// travel. A copy of somebody's half-finished download is not useful to anyone,
// and Office owner files are meaningless on another machine.
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

// TestQuietPeriodPostponesAFreshFile covers the half-written file directly.
//
// A run that starts while somebody is still saving a large document copies
// whatever happens to be on disk at that instant. A schedule is no defence: a
// run every two minutes lands mid-write just as readily as a filesystem watch
// does. The only portable answer is to wait until the file stops changing, and
// the clock is injected here so the test does not have to sleep for it.
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

	// The record must be untouched, so that simply waiting is enough. A skip
	// that wrote a state row would make the engine believe the sides agree.
	j.opt.Compare.Now = time.Now().Add(2 * time.Hour)
	_, res = j.sync(t)
	if res.Copied != 1 {
		t.Fatalf("once settled the file should copy exactly once, got %d", res.Copied)
	}
	requireConverged(t, j, "after the file settled")
}

// TestCaseCollisionIsRefused covers the pair of files a case-insensitive side
// cannot hold.
//
// Copying both means the second silently overwrites the first, and the engine
// would then record that overwrite as a successful sync: one of the two files
// is gone and nothing anywhere says so. Refusing both and naming them is the
// only honest answer.
func TestCaseCollisionIsRefused(t *testing.T) {
	fold := true
	opt := quick()
	opt.ForceFoldCase = &fold
	j := newJob(t, opt)

	write(t, j.left, "Bild.jpg", "the first photo")
	write(t, j.left, "bild.jpg", "a different photo")
	write(t, j.left, "safe.txt", "no trouble here")

	if len(tree(t, j.left)) != 3 {
		// On Windows and macOS the filesystem folded the two names together
		// before the engine ever saw them, so there is genuinely nothing to
		// collide. On Linux there is, and a skip there would mean this test has
		// quietly stopped exercising anything on every platform at once, which
		// is how a suite ends up green and worthless.
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

// TestReservedDirectoryNeverTravels keeps the trash from being synced into the
// other side's trash, which would grow without bound.
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

// TestSkippedWorkLeavesTheRecordAlone states the rule that makes every skip
// safe: postponing is not agreeing.
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
