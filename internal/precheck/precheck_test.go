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
			// The files these tests write are younger than the default quiet
			// period, which would postpone all of them.
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

// remember writes a state row as an earlier run would. Sizes that match
// neither side make the file read as changed.
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

// agreeOn writes a state row that matches a file exactly as it stands. Without
// hashes the comparison uses size and time, which this helper controls.
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

// The side has to have been written to, and nothing may be left on it.
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

// Zero free space would mean full.
func TestABackendThatCannotSaySaysUnknownNotZero(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	// The memory backend is process-wide, so each test uses its own bucket.
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
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("the estimate is still worth having, got %v", rep.Right.Needed)
	}
}

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

// The local backend's Put creates missing parents, root included.
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
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("the first run is the one most likely to fill a disk, so it has to be measured, got %v", rep.Right.Needed)
	}
}

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

func TestAOneWayJobIsNeverWrittenToOnItsSource(t *testing.T) {
	f := newFixture(t)
	f.job.Direction = "leftToRight"
	write(t, f.left, "a.txt", "hello")

	rep := f.check(t, precheck.Opts{})

	if exists(t, filepath.Join(f.left, ".arrowloop")) {
		t.Error("the check wrote to the side this job promises never to touch")
	}
	if !exists(t, filepath.Join(f.right, ".arrowloop")) {
		t.Error("the side that is written to should still have been proved writable")
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

// The free space is forced, since there is no portable way to fill a disk.
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

// Keeping both versions puts each side's file on the other.
func TestAConflictCountsAgainstBothSides(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")     // five bytes
	write(t, f.right, "a.txt", "worldly!") // eight
	// A record that matches neither side makes this a conflict.
	remember(t, f, "a.txt", 1, 1)

	rep := f.check(t, precheck.Opts{})

	if rep.Left.Needed == nil || *rep.Left.Needed != 8 {
		t.Errorf("the left side gains the right side's version, got %v", rep.Left.Needed)
	}
	if rep.Right.Needed == nil || *rep.Right.Needed != 5 {
		t.Errorf("the right side gains the left side's version, got %v", rep.Right.Needed)
	}
}

// A deletion moves the file into the tree's own trash, so it frees nothing.
// The tree is first measured without the record, since an empty plan would
// also need zero bytes.
func TestADeletionFreesNothingAndCostsNothing(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	// A file both sides keep, so the right side does not list empty and trip
	// the empty-side guard.
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

	// With both files recorded, a.txt reads as deleted on the right.
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
	if rep.Known == nil || *rep.Known != 2 {
		t.Errorf("two files were recorded, got %v", rep.Known)
	}
	// No findings, as an empty list rather than null.
	if rep.Findings == nil {
		t.Error("a job with nothing wrong has no findings, not an absent field")
	}
	if len(rep.Findings) != 0 {
		t.Errorf("nothing is wrong with this job, got %+v", rep.Findings)
	}
}

func TestARefusedPlanIsReportedRatherThanHidden(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	// The right side lists nothing while the record says it held files, like
	// a share that failed to mount.
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
	if rep.Left.Free == nil {
		t.Error("the sides can still say how much room they have")
	}
}

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

// A read-only side lists fine and fails on the first transfer. A folder without
// a write bit cannot be made on Windows, so a file blocking the reserved
// directory produces the same refusal on every platform.
func TestASideThatRefusesAWriteIsFatal(t *testing.T) {
	t.Run("the reserved directory cannot be made", func(t *testing.T) {
		f := newFixture(t)
		write(t, f.left, "a.txt", "hello")
		// A file where the reserved directory has to go.
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

	// Root in a container bypasses the permission, so the subtest skips there.
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

// The interface translates from the code and falls back to the sentence.
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

// TestTheReportSurvivesBeingEncoded pins the JSON the browser reads. An
// unknown "free" has to arrive as null, never as 0.
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

// containsBrace spots a template value that was never substituted.
func containsBrace(s string) bool {
	for i := range s {
		if s[i] == '{' {
			return true
		}
	}
	return false
}
