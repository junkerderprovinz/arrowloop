package scenario

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/reeveroll/internal/engine"
)

// TestEmptyDirectoriesTravel covers the folders that hold nothing.
//
// A folder with files in it needs no help: the files imply it. An empty one has
// nothing to imply it, so without a record of its own it can never reach the
// other side. A project skeleton or a folder somebody made ready for next
// month's photos simply fails to arrive, and nothing says so.
func TestEmptyDirectoriesTravel(t *testing.T) {
	opt := quick()
	opt.EmptyDirs = true
	j := newJob(t, opt)

	if err := os.MkdirAll(filepath.Join(j.left, "incoming", "2027"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, j.left, "readme.txt", "not empty")

	_, res := j.sync(t)
	if res.DirsMade != 2 {
		t.Fatalf("expected both folders to be created on the far side, got %d", res.DirsMade)
	}
	for _, want := range []string{"incoming", "incoming/2027"} {
		info, err := os.Stat(filepath.Join(j.right, filepath.FromSlash(want)))
		if err != nil || !info.IsDir() {
			t.Fatalf("%q did not reach the other side: %v", want, err)
		}
	}

	// And a folder the user removes must go away on the other side too, rather
	// than lingering forever because nothing inside it changed.
	if err := os.Remove(filepath.Join(j.left, "incoming", "2027")); err != nil {
		t.Fatalf("rmdir: %v", err)
	}
	_, res = j.sync(t)
	if res.DirsRemoved != 1 {
		t.Fatalf("expected the removed folder to be propagated, got %d removals", res.DirsRemoved)
	}
	if _, err := os.Stat(filepath.Join(j.right, "incoming", "2027")); !os.IsNotExist(err) {
		t.Error("the folder is still on the other side")
	}
	if _, err := os.Stat(filepath.Join(j.right, "incoming")); err != nil {
		t.Error("the parent folder was removed as well, which nobody asked for")
	}
}

// TestEmptyDirectoriesAreOffByDefault pins the default. Carrying folders costs a
// second listing pass and a second record, so a job that does not need it should
// not pay for it.
func TestEmptyDirectoriesAreOffByDefault(t *testing.T) {
	j := newJob(t, quick())
	if err := os.MkdirAll(filepath.Join(j.left, "empty"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, j.left, "real.txt", "content")

	_, res := j.sync(t)
	if res.DirsMade != 0 {
		t.Fatalf("folders were carried without being asked for: %d", res.DirsMade)
	}
	if _, err := os.Stat(filepath.Join(j.right, "empty")); !os.IsNotExist(err) {
		t.Error("an empty folder crossed with the feature switched off")
	}
}

// TestRmdirRefusesToTakeFilesWithIt is the reason removal goes through Rmdir
// instead of a recursive delete.
//
// A folder that still holds something must survive, because what is left in it
// may be exactly the file the engine decided to keep: one it postponed because
// it was still being written, or one it could not read this time round. A
// recursive delete here would quietly undo those decisions.
func TestRmdirRefusesToTakeFilesWithIt(t *testing.T) {
	opt := quick()
	opt.EmptyDirs = true
	j := newJob(t, opt)

	if err := os.MkdirAll(filepath.Join(j.left, "shared"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, j.left, "shared/notes.txt", "somebody's work")
	// A second file outside the folder, so that emptying "shared" does not
	// empty the whole side. Without it the empty-side guard fires first and
	// this test measures that guard instead of the one it is named after.
	write(t, j.left, "elsewhere.txt", "unrelated")
	j.sync(t)
	requireConverged(t, j, "after the first run")

	// The folder disappears on the left, but the right side has meanwhile
	// grown a file inside it that the left never saw.
	if err := os.RemoveAll(filepath.Join(j.left, "shared")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	write(t, j.right, "shared/late-arrival.txt", "written on the other side")

	_, res := j.sync(t)
	if _, err := os.Stat(filepath.Join(j.right, "shared", "late-arrival.txt")); err != nil {
		t.Fatalf("a file that was never deleted was taken out with the folder: %v", err)
	}
	if res.DirsRemoved != 0 {
		t.Errorf("a folder with a live file in it was removed anyway")
	}
}

// TestUnsupportedEntriesAreReported covers what rclone will not carry.
//
// Its local backend drops a symlink from the listing after one log line, so a
// library caller cannot tell it apart from a file that is not there. Saying
// nothing would be the worst outcome: the user is told the folder is in sync
// while part of it was never even looked at.
func TestUnsupportedEntriesAreReported(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "target.txt", "the real file")
	if err := os.Symlink(filepath.Join(j.left, "target.txt"), filepath.Join(j.left, "shortcut.txt")); err != nil {
		// Windows needs developer mode or elevation, and a runner has neither.
		// Anywhere else a failure here means the test has stopped testing, and
		// a skip would hide that on every platform at once.
		if runtime.GOOS != "windows" {
			t.Fatalf("could not create a symlink on %s, so this test no longer exercises anything: %v", runtime.GOOS, err)
		}
		t.Skipf("this system will not create a symlink: %v", err)
	}

	p, _ := j.sync(t)
	var reported bool
	for _, s := range p.Skipped {
		if s.Path == "shortcut.txt" && strings.Contains(s.Reason, "symbolic link") {
			reported = true
		}
	}
	if !reported {
		t.Fatalf("the symlink was skipped without a word: %+v", p.Skipped)
	}
	if _, err := os.Lstat(filepath.Join(j.right, "shortcut.txt")); !os.IsNotExist(err) {
		t.Error("the symlink was carried across after all")
	}
}

// TestLongWindowsPathsSurvive is a claim that has to be measured rather than
// reasoned about.
//
// Windows refuses paths over 260 characters unless the caller opts into the
// extended form. Go's os package has done that automatically for absolute paths
// since 1.20 and rclone's local backend has its own handling, but a sync tool
// cannot take that on trust: the failure would only show up on somebody's
// deeply nested photo archive, long after release.
func TestLongWindowsPathsSurvive(t *testing.T) {
	j := newJob(t, quick())

	segment := strings.Repeat("a", 80)
	deep := strings.Join([]string{segment, segment, segment, segment}, "/")
	rel := deep + "/buried.txt"
	if len(filepath.Join(j.left, filepath.FromSlash(rel))) <= 260 {
		t.Fatalf("the test path is only %d characters, which proves nothing",
			len(filepath.Join(j.left, filepath.FromSlash(rel))))
	}
	write(t, j.left, rel, "found at the bottom")

	_, res := j.sync(t)
	if res.Copied != 1 {
		t.Fatalf("a deeply buried file did not cross on %s: %d copied, skips %+v",
			runtime.GOOS, res.Copied, res.Skipped)
	}
	requireConverged(t, j, "after a long path")
}

// TestManyFilesConvergeInParallel checks that raising the transfer count does
// not cost correctness. Concurrency is where a sync engine grows the sort of bug
// that appears once in fifty runs and is never reproduced on demand.
func TestManyFilesConvergeInParallel(t *testing.T) {
	opt := quick()
	opt.Compare.Transfers = 8
	j := newJob(t, opt)

	for i := range 200 {
		write(t, j.left, fmt.Sprintf("dir%d/file%03d.txt", i%7, i), fmt.Sprintf("content %d", i))
	}
	_, res := j.sync(t)
	if res.Copied != 200 {
		t.Fatalf("expected 200 files across, got %d (skips: %d)", res.Copied, len(res.Skipped))
	}
	requireConverged(t, j, "after a parallel run")

	// A second pass must find nothing left to do, which is the real test: a
	// counter or a record written from two goroutines without protection shows
	// up here as work that never finishes.
	p, res := j.sync(t)
	if len(p.Actions) != 0 || res.Copied != 0 {
		t.Fatalf("the parallel run did not settle: %d actions, %d copied again", len(p.Actions), res.Copied)
	}
	if p.Unchanged != 200 {
		t.Errorf("only %d of 200 files were recorded as agreed", p.Unchanged)
	}
}

// TestPermissionsTravelWhenAsked covers file modes.
//
// Windows has no POSIX mode bits, so there is nothing to compare there. On Unix
// a backup that comes back world-readable is a real problem, and one that a user
// only discovers after restoring.
func TestPermissionsTravelWhenAsked(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no POSIX mode bits to carry")
	}
	opt := quick()
	opt.Metadata = true
	opt.Compare.QuietPeriod = 0
	j := newJob(t, opt)
	configureMetadata(t, true)

	write(t, j.left, "secret.txt", "not for everyone")
	if err := os.Chmod(filepath.Join(j.left, "secret.txt"), 0o600); err != nil {
		t.Fatalf("chmod: %v", err)
	}

	if _, res := j.sync(t); res.Copied != 1 {
		t.Fatalf("the file did not cross: %d", res.Copied)
	}
	info, err := os.Stat(filepath.Join(j.right, "secret.txt"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("the copy is mode %o, the original was 0600; permissions were dropped", got)
	}
}

// configureMetadata flips rclone's global metadata switch and puts it back
// afterwards. It is global because rclone's config is: fs.GetConfig on a
// background context hands out the one default config the whole process shares.
func configureMetadata(t *testing.T, on bool) {
	t.Helper()
	ci := rclonefs.GetConfig(context.Background())
	prev := ci.Metadata
	ci.Metadata = on
	t.Cleanup(func() { ci.Metadata = prev })
}

// TestConfigureSetsTheGlobalsItClaims guards the seam between ReeveRoll's
// options and rclone's process-wide config.
//
// rclone's own binary sets these from its flag parser, which is easy to mistake
// for something that happens by itself. It does not, and a bandwidth limit that
// is accepted and then ignored is worse than one that is refused.
func TestConfigureSetsTheGlobalsItClaims(t *testing.T) {
	base := context.Background()
	global := rclonefs.GetConfig(base)
	prevTransfers, prevMeta := global.Transfers, global.Metadata

	opt := quick()
	opt.Compare.Transfers = 6
	opt.Metadata = true
	jobCtx := engine.Configure(base, opt)

	ci := rclonefs.GetConfig(jobCtx)
	if ci.Transfers != 6 {
		t.Errorf("rclone still thinks transfers is %d", ci.Transfers)
	}
	if !ci.Metadata {
		t.Error("the metadata switch did not reach rclone, so permissions would be dropped silently")
	}

	// The settings must live in the context, not in the process. Two jobs run
	// at once otherwise change each other's behaviour, and the symptom would be
	// a job that behaves differently depending on what else is scheduled.
	if global.Transfers != prevTransfers || global.Metadata != prevMeta {
		t.Errorf("one job's settings leaked into the process-wide config: transfers %d, metadata %v",
			global.Transfers, global.Metadata)
	}

	prevBw := global.BwLimit
	t.Cleanup(func() { global.BwLimit = prevBw })
	if err := engine.StartAccounting(base, "1M"); err != nil {
		t.Fatalf("start accounting: %v", err)
	}
	if global.BwLimit.LimitAt(time.Now()).Bandwidth.Tx <= 0 {
		t.Errorf("the bandwidth limit did not take: %v", global.BwLimit)
	}
	// A limit rclone cannot parse must be refused rather than ignored.
	if err := engine.StartAccounting(base, "not-a-limit"); err == nil {
		t.Error("an unparseable bandwidth limit was accepted")
	}
}
