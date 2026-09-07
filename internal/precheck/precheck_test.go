package precheck_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/memory"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/precheck"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// The whole point of this check is that it is asked BEFORE anything moves, so
// every test here reads the report and then, where it matters, goes and looks
// at the two folders to see whether the check kept its own promise about what
// it would touch.

type fixture struct {
	dir   string
	left  string
	right string
	job   job.Job
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	return &fixture{
		dir:   dir,
		left:  left,
		right: right,
		job: job.Job{
			Name:  "photos",
			Left:  filepath.ToSlash(left),
			Right: filepath.ToSlash(right),
			State: filepath.Join(dir, "photos.db"),
			// Without this every file these tests write is younger than the
			// default quiet period, so the plan postpones all of it and the
			// byte estimate is always zero for reasons that have nothing to do
			// with what is being tested.
			QuietPeriod: "0s",
		},
	}
}

func (f *fixture) check(t *testing.T, opt precheck.Opts) precheck.Report {
	t.Helper()
	return precheck.Check(context.Background(), f.job, opt)
}

func write(t *testing.T, dir, name, content string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// remember writes a state row by hand, which is what a run that has already
// happened leaves behind. Sizes that match nothing on either side are the
// point in some of these tests: they make the file read as changed.
func remember(t *testing.T, f *fixture, path string, leftSize, rightSize int64) {
	t.Helper()
	ctx := context.Background()
	db, err := state.Open(ctx, f.job.State)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	defer db.Close()
	old := time.Now().Add(-24 * time.Hour).UTC()
	err = db.Put(ctx, state.Entry{
		Path: path, LeftPath: path, RightPath: path,
		LeftSize: leftSize, LeftMod: old,
		RightSize: rightSize, RightMod: old,
		AgreedAt: old,
	})
	if err != nil {
		t.Fatalf("put state: %v", err)
	}
}

// agreeOn writes a state row that matches a file exactly as it stands on the
// left, which is what the last run leaves behind for a file nobody has touched
// since. The hashes are left empty on purpose: an empty hash means "unknown"
// everywhere in this engine, so the comparison falls back to size and time,
// which is the pair this helper actually controls.
func agreeOn(t *testing.T, f *fixture, path string, size int64, mod time.Time) {
	t.Helper()
	ctx := context.Background()
	db, err := state.Open(ctx, f.job.State)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	defer db.Close()
	err = db.Put(ctx, state.Entry{
		Path: path, LeftPath: path, RightPath: path,
		LeftSize: size, LeftMod: mod,
		RightSize: size, RightMod: mod,
		AgreedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("put state: %v", err)
	}
}

func findingFor(rep precheck.Report, code, side string) (precheck.Finding, bool) {
	for _, f := range rep.Findings {
		if f.Code == code && f.Side == side {
			return f, true
		}
	}
	return precheck.Finding{}, false
}

func fatals(rep precheck.Report) []string {
	var out []string
	for _, f := range rep.Findings {
		if f.Fatal {
			out = append(out, f.Code+"/"+f.Side)
		}
	}
	return out
}

func exists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	if err == nil {
		return true
	}
	if os.IsNotExist(err) {
		return false
	}
	t.Fatalf("stat %s: %v", path, err)
	return false
}

// TestAHealthyJobMeasuresBothSides is the ordinary answer, and it has to be
// specific rather than merely green: a check that reported "fine" without ever
// having worked out a number would pass a test that only looked at OK.
func TestAHealthyJobMeasuresBothSides(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")

	rep := f.check(t, precheck.Opts{})

	if !rep.OK {
		t.Fatalf("a job with two good folders should be fine, got %v", fatals(rep))
	}
	if rep.Left.Free == nil || rep.Left.Total == nil {
		t.Error("a local folder can say how much room it has, so both numbers should be there")
	}
	if rep.Right.Free == nil || rep.Right.Total == nil {
		t.Error("a local folder can say how much room it has, so both numbers should be there")
	}
	if rep.Left.Free != nil && *rep.Left.Free <= 0 {
		t.Errorf("a disk running these tests has some room on it, got %d", *rep.Left.Free)
	}
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("copying five bytes to the right should need five bytes there, got %v", rep.Right.Needed)
	}
	if rep.Left.Needed == nil || *rep.Left.Needed != 0 {
		t.Errorf("nothing is written to the side the file came from, got %v", rep.Left.Needed)
	}
	if !rep.Left.Written || !rep.Right.Written {
		t.Error("a two-way job writes to both sides")
	}
	if rep.Known == nil || *rep.Known != 0 {
		t.Errorf("a job that has never run knows about no files, got %v", rep.Known)
	}
}

// TestTheWriteProbeCleansUpAfterItself checks both halves of the promise: that
// the side really was written to, and that nothing is left on it afterwards. A
// probe that quietly did nothing would pass the second half alone.
func TestTheWriteProbeCleansUpAfterItself(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")

	f.check(t, precheck.Opts{})

	for _, side := range []string{f.left, f.right} {
		meta := filepath.Join(side, ".arrowloop")
		if !exists(t, meta) {
			t.Errorf("%s was never written to, so nothing was proved about it", side)
			continue
		}
		entries, err := os.ReadDir(meta)
		if err != nil {
			t.Fatalf("read %s: %v", meta, err)
		}
		for _, e := range entries {
			t.Errorf("the check left %s behind in %s", e.Name(), meta)
		}
	}
}

// TestABackendThatCannotSaySaysUnknownNotZero is the rule the whole space check
// stands on. Zero is a real answer meaning "full"; a bucket has no size at all,
// and confusing the two would refuse every job pointed at one.
func TestABackendThatCannotSaySaysUnknownNotZero(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	// A bucket name of its own: the memory backend keeps its contents in one
	// process-wide place, so two tests sharing a name would read each other's.
	f.job.Right = ":memory:precheck-unknown-space"

	rep := f.check(t, precheck.Opts{})

	if rep.Right.Free != nil {
		t.Errorf("a bucket cannot say how much room it has, so free must be unknown, got %d", *rep.Right.Free)
	}
	if rep.Left.Free == nil {
		t.Error("the local side can still say, and one side being unable to must not silence the other")
	}
	found, ok := findingFor(rep, "spaceUnknown", "right")
	if !ok {
		t.Fatalf("an unanswered space question has to be reported, got %+v", rep.Findings)
	}
	if found.Fatal {
		t.Error("a backend with no quota has not gone wrong, so this must not stop the job")
	}
	if !rep.OK {
		t.Errorf("a job onto a bucket is healthy, got %v", fatals(rep))
	}
	// The bytes are still counted. Not knowing what the far side has left is a
	// different thing from not knowing what the run would send.
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("the estimate is still worth having, got %v", rep.Right.Needed)
	}
}

// TestASideThatVanishedIsFatalOnlyWhenItHeldSomething separates the two ways a
// folder can be missing. A job pointed at a share that failed to mount is the
// classic total loss waiting to happen. A job whose destination has simply not
// been created yet is an ordinary new job.
func TestASideThatVanishedIsFatalOnlyWhenItHeldSomething(t *testing.T) {
	t.Run("recorded files make it fatal", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.right, "a.txt", "hello")
		remember(t, f, "a.txt", 5, 5)
		if err := os.RemoveAll(f.left); err != nil {
			t.Fatalf("remove left: %v", err)
		}

		rep := f.check(t, precheck.Opts{})

		found, ok := findingFor(rep, "sideMissing", "left")
		if !ok {
			t.Fatalf("a side that used to hold files and is gone has to be said out loud, got %+v", rep.Findings)
		}
		if !found.Fatal {
			t.Error("this is the failure the check exists for; it cannot be advisory")
		}
		if found.Vars["known"] != "1" {
			t.Errorf("the report should say how much was recorded there, got %q", found.Vars["known"])
		}
		if rep.OK {
			t.Error("a job with a missing side is not fine")
		}
	})

	t.Run("a folder nobody has made yet is not", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")
		if err := os.RemoveAll(f.right); err != nil {
			t.Fatalf("remove right: %v", err)
		}

		rep := f.check(t, precheck.Opts{})

		found, ok := findingFor(rep, "sideNew", "right")
		if !ok {
			t.Fatalf("a destination that does not exist yet should be mentioned, got %+v", rep.Findings)
		}
		if found.Fatal {
			t.Error("the first run creates it, so this must not stop the job")
		}
		if !rep.OK {
			t.Errorf("a brand new job is fine, got %v", fatals(rep))
		}
	})
}

// TestTheCheckDoesNotCreateTheFolderItIsCheckingIs the guard that keeps this a
// question rather than an action. The local backend's Put makes every missing
// parent including the root, so a write probe on a mistyped path would create
// it and the check would then report a healthy job it had just invented.
func TestTheCheckDoesNotCreateTheFolderItIsChecking(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	if err := os.RemoveAll(f.right); err != nil {
		t.Fatalf("remove right: %v", err)
	}

	f.check(t, precheck.Opts{})

	if exists(t, f.right) {
		t.Errorf("the check created %s, so it answered a question about a folder it had just made", f.right)
	}
}

// TestAJobThatHasNeverRunGetsNoStateDatabase is the same promise for the
// record. Opening the job's own path would create it, and somebody asking
// whether a job is set up correctly should not find a new file on their disk
// because they asked.
func TestAJobThatHasNeverRunGetsNoStateDatabase(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")

	rep := f.check(t, precheck.Opts{})

	if exists(t, f.job.State) {
		t.Errorf("the check created %s just by asking about it", f.job.State)
	}
	found, ok := findingFor(rep, "stateNew", "")
	if !ok {
		t.Fatalf("a job that has never run should say so, got %+v", rep.Findings)
	}
	if found.Fatal {
		t.Error("never having run is not a fault")
	}
	// And the estimate still happened, which is the harder half: a job with no
	// record is exactly the job whose first run is the big one.
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("the first run is the one most likely to fill a disk, so it has to be measured, got %v", rep.Right.Needed)
	}
}

// TestAnUnreadableRecordIsFatal covers the state database that is there and is
// not a database, which is what a wrong path or a truncated file looks like. A
// job whose record cannot be read would treat every file on both sides as new.
func TestAnUnreadableRecordIsFatal(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	if err := os.WriteFile(f.job.State, []byte("this is not a database"), 0o644); err != nil {
		t.Fatalf("write state: %v", err)
	}

	rep := f.check(t, precheck.Opts{})

	found, ok := findingFor(rep, "stateUnreadable", "")
	if !ok {
		t.Fatalf("a record that cannot be read has to be reported, got %+v", rep.Findings)
	}
	if !found.Fatal {
		t.Error("without the record a two-way job cannot tell a new file from a deleted one")
	}
	if found.Vars["error"] == "" {
		t.Error("the database's own words are what makes this fixable")
	}
	if rep.Known != nil {
		t.Errorf("nothing was counted, so the count must not claim otherwise, got %d", *rep.Known)
	}
	if rep.OK {
		t.Error("a job with an unreadable record is not fine")
	}
}

// TestAOneWayJobIsNeverWrittenToOnItsSource. Choosing a direction is a promise
// that one side is only ever read, and a check that wrote a probe there to
// prove it could would break exactly that promise.
func TestAOneWayJobIsNeverWrittenToOnItsSource(t *testing.T) {
	f := newFixture(t)
	f.job.Direction = "leftToRight"
	write(t, f.left, "a.txt", "hello")

	rep := f.check(t, precheck.Opts{})

	if exists(t, filepath.Join(f.left, ".arrowloop")) {
		t.Error("the check wrote to the side this job promises never to touch")
	}
	if !exists(t, filepath.Join(f.right, ".arrowloop")) {
		t.Error("the side that IS written to should still have been proved writable")
	}
	found, ok := findingFor(rep, "sideNotWritten", "left")
	if !ok {
		t.Fatalf("a side that went untested should say so rather than look proved, got %+v", rep.Findings)
	}
	if found.Fatal {
		t.Error("not writing to the source is the job working as asked")
	}
	if rep.Left.Written || !rep.Right.Written {
		t.Errorf("a left-to-right job writes only to the right, got left=%v right=%v", rep.Left.Written, rep.Right.Written)
	}
	if !rep.OK {
		t.Errorf("a one-way job is fine, got %v", fatals(rep))
	}
}

// TestARunThatWouldNotFitIsRefused is the whole of the first feature. The free
// number is said out loud rather than manufactured, because a disk with a
// handful of bytes left is an ordinary state of a real disk and there is no
// portable way to stand in one.
func TestARunThatWouldNotFitIsRefused(t *testing.T) {
	t.Run("more bytes than room", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")

		rep := f.check(t, precheck.Opts{ForceFree: map[plan.Side]int64{plan.Right: 4}})

		found, ok := findingFor(rep, "notEnoughSpace", "right")
		if !ok {
			t.Fatalf("five bytes do not fit in four, got %+v", rep.Findings)
		}
		if !found.Fatal {
			t.Error("a run that fills the destination leaves half-written files, so it must not start")
		}
		if found.Vars["needed"] != "5" || found.Vars["free"] != "4" {
			t.Errorf("both numbers belong in the report, got %+v", found.Vars)
		}
		if rep.OK {
			t.Error("a job that would not fit is not fine")
		}
	})

	t.Run("exactly enough room", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")

		rep := f.check(t, precheck.Opts{ForceFree: map[plan.Side]int64{plan.Right: 5}})

		if _, ok := findingFor(rep, "notEnoughSpace", "right"); ok {
			t.Error("five bytes fit in five; a check that refuses what would have worked gets switched off")
		}
		if !rep.OK {
			t.Errorf("this run fits, got %v", fatals(rep))
		}
	})

	t.Run("room unknown never refuses", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")
		f.job.Right = ":memory:precheck-unknown-never-refuses"

		rep := f.check(t, precheck.Opts{})

		if _, ok := findingFor(rep, "notEnoughSpace", "right"); ok {
			t.Error("not knowing how much room there is must never be read as having none")
		}
	})
}

// TestAConflictCountsAgainstBothSides is the least obvious piece of the
// arithmetic. Keeping both versions leaves each side holding the other side's
// file beside its own, so a conflict costs room on both ends and not on one.
func TestAConflictCountsAgainstBothSides(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")     // five bytes
	write(t, f.right, "a.txt", "worldly!") // eight
	// A record that matches neither side, so both read as changed since the
	// last agreement and the plan calls it a conflict.
	remember(t, f, "a.txt", 1, 1)

	rep := f.check(t, precheck.Opts{})

	if rep.Left.Needed == nil || *rep.Left.Needed != 8 {
		t.Errorf("the left side gains the right side's version, got %v", rep.Left.Needed)
	}
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("the right side gains the left side's version, got %v", rep.Right.Needed)
	}
}

// TestADeletionFreesNothingAndCostsNothing is the rule that stops this check
// waving through the very run it exists to catch. A deletion in this program is
// a move into the tree's own trash, which lives inside the same tree, so a run
// that removes a hundred gigabytes has a hundred gigabytes exactly where it had
// them before.
//
// The first half is there so the second half cannot pass for the wrong reason.
// Zero bytes needed is also what a plan with nothing in it reports, so the same
// tree is measured first WITHOUT the record, where it has to come to five.
func TestADeletionFreesNothingAndCostsNothing(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	// A second file that both sides keep. The engine refuses to believe a side
	// that lists nothing at all while the record says it held files, so a tree
	// where the ONLY recorded file has gone is a tree no plan is ever built
	// for, and this test would be measuring that refusal instead.
	write(t, f.left, "b.txt", "keepme")
	write(t, f.right, "b.txt", "keepme")
	stamp := time.Now().Add(-time.Hour).Truncate(time.Second)
	for _, side := range []string{f.left, f.right} {
		if err := os.Chtimes(filepath.Join(side, "b.txt"), stamp, stamp); err != nil {
			t.Fatalf("chtimes: %v", err)
		}
	}

	before := f.check(t, precheck.Opts{})
	if before.Right.Needed == nil || *before.Right.Needed != 5 {
		t.Fatalf("without a record a.txt is new and would be copied, got %v", before.Right.Needed)
	}

	// Now say the two sides once agreed on both files, exactly as they stand.
	// The right side no longer has a.txt, so the run would delete it on the
	// left, and nothing else would happen at all.
	info, err := os.Stat(filepath.Join(f.left, "a.txt"))
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	agreeOn(t, f, "a.txt", info.Size(), info.ModTime())
	agreeOn(t, f, "b.txt", int64(len("keepme")), stamp)

	rep := f.check(t, precheck.Opts{})

	if rep.Left.Needed == nil || *rep.Left.Needed != 0 {
		t.Errorf("a deletion writes nothing, got %v", rep.Left.Needed)
	}
	if rep.Right.Needed == nil || *rep.Right.Needed != 0 {
		t.Errorf("a deletion writes nothing on the other side either, got %v", rep.Right.Needed)
	}
	if !rep.OK {
		t.Errorf("this job is fine, got %v", fatals(rep))
	}
	// The count comes from the record that is actually there, and it is what
	// the missing-side decision is made against: a side listing nothing is
	// ordinary when this number is zero and an emergency when it is not.
	if rep.Known == nil || *rep.Known != 2 {
		t.Errorf("two files were recorded, got %v", rep.Known)
	}
	// And with the record in place there is nothing at all left to say, which
	// has to reach the browser as an empty list rather than as null: a screen
	// promised a list of findings should not have to guard every use of it.
	if rep.Findings == nil {
		t.Error("a job with nothing wrong has no findings, not an absent field")
	}
	if len(rep.Findings) != 0 {
		t.Errorf("nothing is wrong with this job, got %+v", rep.Findings)
	}
}

// TestARefusedPlanIsReportedRatherThanHidden. The engine has brakes of its own,
// and a job that those brakes would stop is a job that will not run tonight.
// Saying so here, in the engine's own words, means there is one wording to
// recognise rather than two.
func TestARefusedPlanIsReportedRatherThanHidden(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	// The right side exists and lists nothing while the record says it held
	// files, which is what a share that failed to mount looks like from the
	// inside: the folder is there, the contents are not.
	remember(t, f, "a.txt", 5, 5)

	rep := f.check(t, precheck.Opts{})

	found, ok := findingFor(rep, "planFailed", "")
	if !ok {
		t.Fatalf("a run the engine would refuse has to show up here, got %+v", rep.Findings)
	}
	if !found.Fatal {
		t.Error("the engine refusing to run is not advisory")
	}
	if found.Vars["error"] == "" || found.Text == "" {
		t.Error("the engine's own sentence is the useful part")
	}
	if rep.OK {
		t.Error("a job the engine would refuse is not fine")
	}
}

// TestSkippingTheEstimateSaysSo. The listing pass costs minutes on a large tree,
// so it can be left out, and a report that left it out must not read like one
// that measured and found room to spare.
func TestSkippingTheEstimateSaysSo(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")

	rep := f.check(t, precheck.Opts{NoEstimate: true})

	if _, ok := findingFor(rep, "estimateSkipped", ""); !ok {
		t.Fatalf("an unmeasured space check has to admit it, got %+v", rep.Findings)
	}
	if rep.Left.Needed != nil || rep.Right.Needed != nil {
		t.Error("nothing was worked out, so no number should be offered")
	}
	if !rep.OK {
		t.Errorf("skipping the estimate is not a fault, got %v", fatals(rep))
	}
	// The cheap half still ran, which is the reason to offer the option at all.
	if rep.Left.Free == nil {
		t.Error("the sides can still say how much room they have")
	}
}

// TestAHalfWrittenJobIsRefusedBeforeAnythingIsOpened. A job switched off while
// somebody fills it in is allowed to be missing a side; checking one has to say
// so rather than hand an empty string to a backend and report what it makes of
// it.
func TestAHalfWrittenJobIsRefusedBeforeAnythingIsOpened(t *testing.T) {
	f := newFixture(t)
	f.job.Right = ""

	rep := f.check(t, precheck.Opts{})

	found, ok := findingFor(rep, "halfWritten", "")
	if !ok {
		t.Fatalf("a job with one side is not a job, got %+v", rep.Findings)
	}
	if !found.Fatal || rep.OK {
		t.Error("a job that cannot run is not fine")
	}
	if len(rep.Findings) != 1 {
		t.Errorf("nothing else was worth asking, got %+v", rep.Findings)
	}
}

// TestASideThatIsNotAFolderIsReported covers the everyday typo of pointing a
// side at a file. rclone refuses to open it as a filesystem, and the check has
// to carry that refusal rather than swallow it.
func TestASideThatIsNotAFolderIsReported(t *testing.T) {
	f := newFixture(t)
	notAFolder := filepath.Join(f.dir, "notes.txt")
	if err := os.WriteFile(notAFolder, []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	f.job.Right = filepath.ToSlash(notAFolder)

	rep := f.check(t, precheck.Opts{})

	found, ok := findingFor(rep, "sideUnreachable", "right")
	if !ok {
		t.Fatalf("a side that will not open has to be reported, got %+v", rep.Findings)
	}
	if !found.Fatal || rep.OK {
		t.Error("a side that cannot be opened stops the job")
	}
	if found.Vars["error"] == "" {
		t.Error("the backend's own words are what makes this fixable")
	}
}

// TestASideThatRefusesAWriteIsFatal is the read-only share, which lists
// perfectly and fails on the first transfer.
//
// Two ways in, because only one of them exists everywhere. A folder with no
// write bit is the real shape of the problem and Windows cannot express it with
// a mode bit at all; a reserved directory that cannot be made is the same
// refusal reached through a name, and it works on every platform. Both end at
// the same place: the backend said no when it was asked to write.
func TestASideThatRefusesAWriteIsFatal(t *testing.T) {
	t.Run("the reserved directory cannot be made", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")
		// A FILE where the tool's own directory has to go. The scanner skips
		// this name on both sides, so nothing ever removes it, and the trash a
		// real run needs could not be made here either.
		if err := os.WriteFile(filepath.Join(f.right, ".arrowloop"), []byte("in the way"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}

		rep := f.check(t, precheck.Opts{})

		found, ok := findingFor(rep, "sideReadOnly", "right")
		if !ok {
			t.Fatalf("a side that refuses a file has to be reported, got %+v", rep.Findings)
		}
		if !found.Fatal || rep.OK {
			t.Error("a job that cannot write to its destination cannot run")
		}
		if found.Vars["error"] == "" {
			t.Error("the backend's own words are what makes this fixable")
		}
	})

	// A user whose account bypasses permissions entirely, such as root in a
	// container, cannot reach this state either, and the test says so instead
	// of pretending to have tested it.
	t.Run("a folder with no write bit", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("a read-only folder is not something a Windows mode bit can make")
		}
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")

		if err := os.Chmod(f.right, 0o555); err != nil {
			t.Fatalf("chmod: %v", err)
		}
		t.Cleanup(func() { _ = os.Chmod(f.right, 0o755) })
		if err := os.WriteFile(filepath.Join(f.right, "probe"), []byte("x"), 0o644); err == nil {
			_ = os.Remove(filepath.Join(f.right, "probe"))
			t.Skip("this user can write into a folder with no write bit, so the state under test cannot be reached")
		}

		rep := f.check(t, precheck.Opts{})

		found, ok := findingFor(rep, "sideReadOnly", "right")
		if !ok {
			t.Fatalf("a side that refuses a file has to be reported, got %+v", rep.Findings)
		}
		if !found.Fatal || rep.OK {
			t.Error("a job that cannot write to its destination cannot run")
		}
	})
}

// TestEveryFindingCarriesWordsAndACode. The interface translates from the code
// and falls back to the sentence for a code it has never heard of, so a finding
// with neither is a row nobody can act on.
func TestEveryFindingCarriesWordsAndACode(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	f.job.Right = ":memory:precheck-wording"

	for _, rep := range []precheck.Report{
		f.check(t, precheck.Opts{}),
		precheck.Check(context.Background(), job.Job{Name: "empty"}, precheck.Opts{}),
	} {
		if len(rep.Findings) == 0 {
			t.Fatalf("%s produced nothing to look at", rep.Job)
		}
		for _, found := range rep.Findings {
			if found.Code == "" {
				t.Errorf("%s: a finding with no code cannot be translated: %+v", rep.Job, found)
			}
			if found.Text == "" {
				t.Errorf("%s: %q has no wording, so an interface that does not know it shows a blank", rep.Job, found.Code)
			}
			if left := fmt.Sprintf("%v", found.Text); containsBrace(left) {
				t.Errorf("%s: %q left a placeholder unfilled: %q", rep.Job, found.Code, found.Text)
			}
		}
	}
}

// TestTheReportSurvivesBeingEncoded pins the contract the browser reads.
//
// The handler does nothing to this structure but hand it to the encoder, so
// this is where a renamed field or a number that quietly became zero would show
// up. The unknown case is the one worth pinning: "free" has to arrive as null
// and never as 0, because a screen cannot tell a full disk from an unanswerable
// question once the difference has been encoded away.
func TestTheReportSurvivesBeingEncoded(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	f.job.Right = ":memory:precheck-encoding"

	raw, err := json.Marshal(f.check(t, precheck.Opts{}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for _, key := range []string{"job", "ok", "findings", "left", "right", "known"} {
		if _, ok := doc[key]; !ok {
			t.Errorf("the report lost its %q field: %s", key, raw)
		}
	}
	if _, ok := doc["findings"].([]any); !ok {
		t.Errorf("findings has to arrive as a list, got %T", doc["findings"])
	}
	right, ok := doc["right"].(map[string]any)
	if !ok {
		t.Fatalf("a side has to arrive as an object, got %T", doc["right"])
	}
	for _, key := range []string{"path", "free", "total", "needed", "written"} {
		if _, ok := right[key]; !ok {
			t.Errorf("a side lost its %q field: %s", key, raw)
		}
	}
	if right["free"] != nil {
		t.Errorf("a bucket that cannot say must arrive as null, got %v", right["free"])
	}
	if right["needed"] == nil {
		t.Error("the bytes a run would send are known even when the room for them is not")
	}
	left := doc["left"].(map[string]any)
	if left["free"] == nil {
		t.Error("a local side can say, and its answer has to survive the encoding")
	}
}

// containsBrace spots a template value that was never substituted, which is how
// a wording and its variables silently stop matching each other.
func containsBrace(s string) bool {
	for i := range s {
		if s[i] == '{' {
			return true
		}
	}
	return false
}
