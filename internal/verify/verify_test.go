package verify_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/object"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/memory"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
	"github.com/junkerderprovinz/arrowloop/internal/verify"
)

// The tests stage records by hand. A record that disagrees with the sides is
// reachable (a restored backup, a copied database, a crash, a hand edit), but
// the apply stage never writes one, so this is the only way to produce it.

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
		},
	}
}

func (f *fixture) check(t *testing.T, opt verify.Opts) verify.Report {
	t.Helper()
	rep, err := verify.Check(context.Background(), f.job, opt)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	return rep
}

// settled is an hour ago, so the engine's quiet period postpones nothing these
// tests write.
var settled = time.Now().Add(-time.Hour).Truncate(time.Second)

// write puts a file on one side and dates it to settled.
func write(t *testing.T, dir, name, content string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Chtimes(full, settled, settled); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
}

func openState(t *testing.T, f *fixture) *state.DB {
	t.Helper()
	db, err := state.Open(context.Background(), f.job.State)
	if err != nil {
		t.Fatalf("open state: %v", err)
	}
	return db
}

// emptyRecord makes the database without putting anything in it. The check
// refuses a job with no database at all.
func emptyRecord(t *testing.T, f *fixture) {
	t.Helper()
	openState(t, f).Close()
}

func putRow(t *testing.T, f *fixture, e state.Entry) {
	t.Helper()
	db := openState(t, f)
	defer db.Close()
	if e.AgreedAt.IsZero() {
		e.AgreedAt = settled
	}
	if err := db.Put(context.Background(), e); err != nil {
		t.Fatalf("put row: %v", err)
	}
}

// agreeOn writes the row a finished run would leave for a file as it stands on
// both sides. Without hashes the comparison uses size and time.
func agreeOn(t *testing.T, f *fixture, path string) {
	t.Helper()
	left := stat(t, filepath.Join(f.left, filepath.FromSlash(path)))
	right := stat(t, filepath.Join(f.right, filepath.FromSlash(path)))
	putRow(t, f, state.Entry{
		Path: path, LeftPath: path, RightPath: path,
		LeftSize: left.Size(), LeftMod: left.ModTime(),
		RightSize: right.Size(), RightMod: right.ModTime(),
	})
}

func stat(t *testing.T, path string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info
}

func findingFor(rep verify.Report, code, path string) (verify.Finding, bool) {
	for _, f := range rep.Findings {
		if f.Code == code && f.Path == path {
			return f, true
		}
	}
	return verify.Finding{}, false
}

func codes(rep verify.Report) []string {
	var out []string
	for _, f := range rep.Findings {
		out = append(out, f.Code+" "+f.Path)
	}
	return out
}

// wouldDoNothing asks the engine what it would do with the tree, to prove that
// a frozen disagreement really is invisible to it.
func wouldDoNothing(t *testing.T, f *fixture) (actions, unchanged int) {
	t.Helper()
	ctx := context.Background()
	settings, err := f.job.Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	ends := apply.Ends{Left: openFs(t, f.job.Left), Right: openFs(t, f.job.Right)}
	db := openState(t, f)
	defer db.Close()
	p, _, err := engine.Prepare(engine.Configure(ctx, settings), ends, db, settings)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	return len(p.Actions), p.Unchanged
}

func openFs(t *testing.T, path string) rclonefs.Fs {
	t.Helper()
	f, err := rclonefs.NewFs(context.Background(), path)
	if err != nil {
		t.Fatalf("open %s: %v", path, err)
	}
	return f
}

// Both sides match their half of the record, so every run calls them
// unchanged, yet they hold different files.
func TestAFrozenDisagreementIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "worldly!")
	// A row that claims agreement and describes each side as it stands.
	putRow(t, f, state.Entry{
		Path: "a.txt", LeftPath: "a.txt", RightPath: "a.txt",
		LeftSize: 5, LeftMod: settled,
		RightSize: 8, RightMod: settled,
	})

	actions, unchanged := wouldDoNothing(t, f)
	if actions != 0 || unchanged != 1 {
		t.Fatalf("this test is only interesting if the engine ignores the file: %d actions, %d unchanged", actions, unchanged)
	}

	rep := f.check(t, verify.Opts{})

	found, ok := findingFor(rep, "agreedButDiffer", "a.txt")
	if !ok {
		t.Fatalf("a row claiming an agreement that does not hold is the failure this exists for, got %v", codes(rep))
	}
	if !found.Invisible {
		t.Error("no run will ever notice this, and a screen has to be told so")
	}
	if found.Vars["leftSize"] != "5" || found.Vars["rightSize"] != "8" {
		t.Errorf("both versions belong in the finding, got %+v", found.Vars)
	}
	if found.Text == "" {
		t.Error("a finding an interface has never heard of still has to say something")
	}
	if rep.Found != 1 || rep.Returned != 1 || rep.Truncated {
		t.Errorf("one finding, all of it returned, got found=%d returned=%d truncated=%v", rep.Found, rep.Returned, rep.Truncated)
	}

	// With a truthful record the same tree has nothing to report.
	write(t, f.right, "a.txt", "hello")
	agreeOn(t, f, "a.txt")
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("two sides that really do agree produce no findings, got %v", codes(rep))
	}
}

// Two files of the same length written in the same second look equal by size
// and time, so only a check with checksums sees the difference.
func TestWhatAChecksumlessCheckCannotSee(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "world") // same five bytes, same second
	agreeOn(t, f, "a.txt")

	blind := f.check(t, verify.Opts{})
	if blind.Found != 0 {
		t.Errorf("size and time cannot tell these apart, and pretending otherwise would be luck rather than a check, got %v", codes(blind))
	}
	if blind.Checksums {
		t.Error("the report has to say it did not read the content")
	}
	if blind.Checked != 1 {
		t.Errorf("the file was still looked at, got %d", blind.Checked)
	}

	seeing := f.check(t, verify.Opts{Checksums: true})
	found, ok := findingFor(seeing, "agreedButDiffer", "a.txt")
	if !ok {
		t.Fatalf("with the content read, these two are plainly different, got %v", codes(seeing))
	}
	if !seeing.Checksums {
		t.Error("the report has to say it did read the content")
	}
	if found.Vars["leftHash"] == "" || found.Vars["leftHash"] == found.Vars["rightHash"] {
		t.Errorf("the two checksums are what decided this, so they belong in the finding, got %+v", found.Vars)
	}
}

// A run interrupted before it dropped a row leaves one for a file that is gone.
func TestARowForAFileOnNeitherSideIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "b.txt", "kept")
	write(t, f.right, "b.txt", "kept")
	agreeOn(t, f, "b.txt")
	putRow(t, f, state.Entry{
		Path: "ghost.txt", LeftPath: "ghost.txt", RightPath: "ghost.txt",
		LeftSize: 3, LeftMod: settled, RightSize: 3, RightMod: settled,
	})

	rep := f.check(t, verify.Opts{})

	found, ok := findingFor(rep, "recordedButOnNeitherSide", "ghost.txt")
	if !ok {
		t.Fatalf("a row for a file nobody has has to be reported, got %v", codes(rep))
	}
	if found.Invisible {
		t.Error("the next run drops this row by itself, so it must not be filed with the ones that never heal")
	}
	if rep.Found != 1 {
		t.Errorf("the file both sides agree on is not a finding, got %v", codes(rep))
	}

	// Without the stray row the same tree is clean.
	db := openState(t, f)
	if err := db.Forget(context.Background(), "ghost.txt"); err != nil {
		t.Fatalf("forget: %v", err)
	}
	db.Close()
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("nothing is wrong with this job, got %v", codes(rep))
	}
}

func TestAFileOnBothSidesTheRecordNeverHeardOfIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "hello")
	write(t, f.left, "b.txt", "kept")
	write(t, f.right, "b.txt", "kept")
	agreeOn(t, f, "b.txt")

	rep := f.check(t, verify.Opts{})

	found, ok := findingFor(rep, "onBothSidesUnrecorded", "a.txt")
	if !ok {
		t.Fatalf("a file the record has never heard of has to be reported, got %v", codes(rep))
	}
	if found.Invisible {
		t.Error("the next run compares these two and writes the row, so this one heals itself")
	}
	if rep.Found != 1 {
		t.Errorf("only the unrecorded file is a finding, got %v", codes(rep))
	}

	agreeOn(t, f, "a.txt")
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("once the record knows about it there is nothing to say, got %v", codes(rep))
	}
}

func TestAFileTheRecordSaysWasOnBothSidesAndIsOnOneIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "hello")
	write(t, f.left, "b.txt", "kept")
	write(t, f.right, "b.txt", "kept")
	agreeOn(t, f, "a.txt")
	agreeOn(t, f, "b.txt")
	if err := os.Remove(filepath.Join(f.right, "a.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}

	rep := f.check(t, verify.Opts{})

	found, ok := findingFor(rep, "recordedButOnOneSideOnly", "a.txt")
	if !ok {
		t.Fatalf("a recorded file that is only on one side has to be reported, got %v", codes(rep))
	}
	if found.Side != "left" {
		t.Errorf("the side that still holds it is the useful half, got %q", found.Side)
	}
	if found.Invisible {
		t.Error("the next run propagates this, so it is not one of the ones that never heal")
	}
	if strings.Contains(found.Text, "{") {
		t.Errorf("the wording left a placeholder unfilled: %q", found.Text)
	}
	if rep.Found != 1 {
		t.Errorf("only the one-sided file is a finding, got %v", codes(rep))
	}

	write(t, f.right, "a.txt", "hello")
	agreeOn(t, f, "a.txt")
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("with the file back on both sides there is nothing to say, got %v", codes(rep))
	}
}

func TestANewFileOnOneSideIsNotAFinding(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "b.txt", "kept")
	write(t, f.right, "b.txt", "kept")
	agreeOn(t, f, "b.txt")
	write(t, f.left, "brand-new.txt", "just made")

	rep := f.check(t, verify.Opts{})

	if rep.Found != 0 {
		t.Errorf("a new file is not an inconsistency, got %v", codes(rep))
	}
	if rep.Checked != 2 {
		t.Errorf("it was still looked at, got %d paths checked", rep.Checked)
	}
}

// A row whose two halves describe different files never stood for an
// agreement.
func TestARowThatContradictsItselfIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "hello")
	putRow(t, f, state.Entry{
		Path: "a.txt", LeftPath: "a.txt", RightPath: "a.txt",
		LeftSize: 5, LeftMod: settled,
		// The right side no longer matches this, which keeps the case apart
		// from a frozen disagreement.
		RightSize: 8, RightMod: settled,
	})

	rep := f.check(t, verify.Opts{})

	found, ok := findingFor(rep, "recordDisagreesWithItself", "a.txt")
	if !ok {
		t.Fatalf("a row that describes two different files has to be reported, got %v", codes(rep))
	}
	if found.Invisible {
		t.Error("one side no longer matches its half, so the next run acts on this")
	}
	if found.Vars["leftSize"] != "5" || found.Vars["rightSize"] != "8" {
		t.Errorf("the row's own two halves are what is being reported, got %+v", found.Vars)
	}

	agreeOn(t, f, "a.txt")
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("a row that describes what is really there is not a finding, got %v", codes(rep))
	}
}

func TestTheListIsBoundedAndTheTotalIsNot(t *testing.T) {
	f := newFixture(t)
	emptyRecord(t, f)
	for i := 0; i < 12; i++ {
		name := fmt.Sprintf("file-%02d.txt", i)
		write(t, f.left, name, "same on both sides")
		write(t, f.right, name, "same on both sides")
	}

	rep := f.check(t, verify.Opts{Limit: 5})

	if rep.Found != 12 {
		t.Errorf("every file is unknown to the record, so all twelve were found, got %d", rep.Found)
	}
	if rep.Returned != 5 || len(rep.Findings) != 5 {
		t.Errorf("the list was asked to stop at five, got returned=%d len=%d", rep.Returned, len(rep.Findings))
	}
	if !rep.Truncated {
		t.Error("a truncated list that does not say so reads as a complete one")
	}

	// A bounded list has to hold the same findings every time.
	first := codes(rep)
	if first[0] != "onBothSidesUnrecorded file-00.txt" {
		t.Errorf("the list starts at the first path in order, got %q", first[0])
	}
	again := codes(f.check(t, verify.Opts{Limit: 5}))
	for i := range first {
		if first[i] != again[i] {
			t.Fatalf("two checks of the same tree disagreed at %d: %q and %q", i, first[i], again[i])
		}
	}

	whole := f.check(t, verify.Opts{Limit: 100})
	if whole.Truncated || whole.Returned != 12 {
		t.Errorf("a bound nothing reaches truncates nothing, got returned=%d truncated=%v", whole.Returned, whole.Truncated)
	}
}

// An excluded path is hidden from the listings while its row stays in the
// record.
func TestAnExcludedFileIsNotReportedAsMissing(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "b.txt", "kept")
	write(t, f.right, "b.txt", "kept")
	agreeOn(t, f, "b.txt")
	// *.tmp is excluded by default.
	write(t, f.left, "notes.tmp", "scratch")
	write(t, f.right, "notes.tmp", "scratch")
	agreeOn(t, f, "notes.tmp")

	rep := f.check(t, verify.Opts{})

	if rep.Found != 0 {
		t.Errorf("an excluded file is hidden from the record as well as from the sides, got %v", codes(rep))
	}
	if rep.Known != 1 {
		t.Errorf("the excluded row is not part of what was checked, got %d known", rep.Known)
	}

	// A visible row whose file really is gone is still reported.
	putRow(t, f, state.Entry{
		Path: "notes.txt", LeftPath: "notes.txt", RightPath: "notes.txt",
		LeftSize: 7, LeftMod: settled, RightSize: 7, RightMod: settled,
	})
	if _, ok := findingFor(f.check(t, verify.Opts{}), "recordedButOnNeitherSide", "notes.txt"); !ok {
		t.Error("a row for a file that is genuinely gone still has to be reported")
	}
}

// A share that failed to mount lists nothing; the check returns the engine's
// refusal instead of one finding per recorded file.
func TestASideThatListsNothingIsRefusedRatherThanCompared(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 3; i++ {
		name := fmt.Sprintf("file-%d.txt", i)
		write(t, f.left, name, "content")
		write(t, f.right, name, "content")
		agreeOn(t, f, name)
	}
	if before := f.check(t, verify.Opts{}); before.Found != 0 {
		t.Fatalf("this tree is in order before the side goes away, got %v", codes(before))
	}

	entries, err := os.ReadDir(f.right)
	if err != nil {
		t.Fatalf("read right: %v", err)
	}
	for _, e := range entries {
		if err := os.Remove(filepath.Join(f.right, e.Name())); err != nil {
			t.Fatalf("remove: %v", err)
		}
	}

	rep, err := verify.Check(context.Background(), f.job, verify.Opts{})

	var empty *plan.EmptySideError
	if !errors.As(err, &empty) {
		t.Fatalf("an empty side has to be refused in the engine's own words, got %v", err)
	}
	if empty.Side != plan.Right || empty.Known != 3 {
		t.Errorf("the refusal has to name the side and what was known there, got %v", err)
	}
	if rep.Findings == nil {
		t.Error("even a refused check hands back a list rather than a null")
	}
	if len(rep.Findings) != 0 {
		t.Errorf("nothing was compared, so nothing may be claimed, got %v", codes(rep))
	}
}

func TestAJobThatHasNeverRunIsRefusedAndGetsNoDatabase(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "hello")

	rep, err := verify.Check(context.Background(), f.job, verify.Opts{})

	if err == nil {
		t.Fatalf("a job with no record cannot be checked, got %+v", rep)
	}
	if !strings.Contains(err.Error(), f.job.State) {
		t.Errorf("the message has to name the record it looked for, got %v", err)
	}
	if _, statErr := os.Stat(f.job.State); statErr == nil {
		t.Errorf("the check created %s just by asking about it", f.job.State)
	}

	emptyRecord(t, f)
	if _, err := verify.Check(context.Background(), f.job, verify.Opts{}); err != nil {
		t.Errorf("a job with a record can be checked, got %v", err)
	}
}

// The scanner drops a colliding key from its side, while the record keeps its
// row. Memory backends are case-sensitive on every platform, unlike a local
// folder on Windows.
func TestCollidingNamesAreLeftOutRatherThanReportedAsMissing(t *testing.T) {
	fold := true
	f := newFixture(t)
	f.job.Left = ":memory:verify-collision-left"
	f.job.Right = ":memory:verify-collision-right"
	f.job.FoldCase = &fold

	putRemote(t, f.job.Left, "A.txt", "hello")
	putRemote(t, f.job.Left, "a.txt", "hello")
	putRemote(t, f.job.Right, "a.txt", "hello")
	putRow(t, f, state.Entry{
		Path: "a.txt", LeftPath: "a.txt", RightPath: "a.txt",
		LeftSize: 5, LeftMod: settled, RightSize: 5, RightMod: settled,
	})
	// A file that does not collide, so the left side does not list empty.
	putRemote(t, f.job.Left, "keep.txt", "kept")
	putRemote(t, f.job.Right, "keep.txt", "kept")
	putRow(t, f, state.Entry{
		Path: "keep.txt", LeftPath: "keep.txt", RightPath: "keep.txt",
		LeftSize: 4, LeftMod: settled, RightSize: 4, RightMod: settled,
	})

	rep := f.check(t, verify.Opts{})

	if rep.Collisions != 1 {
		t.Errorf("the colliding key has to be counted, got %d", rep.Collisions)
	}
	if rep.Found != 0 {
		t.Errorf("the file is on the left twice over, so calling it missing there would be a false alarm, got %v", codes(rep))
	}

	// Where the row really has lost its file on the left, it is still reported.
	other := newFixture(t)
	other.job.Left = ":memory:verify-collision-control-left"
	other.job.Right = ":memory:verify-collision-control-right"
	other.job.FoldCase = &fold
	putRemote(t, other.job.Left, "B.txt", "hello")
	putRemote(t, other.job.Right, "a.txt", "hello")
	putRow(t, other, state.Entry{
		Path: "a.txt", LeftPath: "a.txt", RightPath: "a.txt",
		LeftSize: 5, LeftMod: settled, RightSize: 5, RightMod: settled,
	})
	if _, ok := findingFor(other.check(t, verify.Opts{}), "recordedButOnOneSideOnly", "a.txt"); !ok {
		t.Error("a recorded file that really is gone from one side is still reported")
	}
}

// putRemote writes one file into an rclone backend.
func putRemote(t *testing.T, remote, name, body string) {
	t.Helper()
	ctx := context.Background()
	f := openFs(t, remote)
	info := object.NewStaticObjectInfo(name, settled, int64(len(body)), true, nil, f)
	if _, err := f.Put(ctx, strings.NewReader(body), info); err != nil {
		t.Fatalf("put %s into %s: %v", name, remote, err)
	}
}

// The interface translates from the code and falls back to the sentence.
func TestEveryFindingCarriesWordsAndACode(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "kept.txt", "kept")
	write(t, f.right, "kept.txt", "kept")
	agreeOn(t, f, "kept.txt")

	write(t, f.left, "unknown.txt", "new to the record")
	write(t, f.right, "unknown.txt", "new to the record")

	write(t, f.left, "one-sided.txt", "here")
	agreeOn2(t, f, "one-sided.txt", 4, 4)

	putRow(t, f, state.Entry{
		Path: "ghost.txt", LeftPath: "ghost.txt", RightPath: "ghost.txt",
		LeftSize: 1, LeftMod: settled, RightSize: 1, RightMod: settled,
	})

	write(t, f.left, "frozen.txt", "hello")
	write(t, f.right, "frozen.txt", "worldly!")
	putRow(t, f, state.Entry{
		Path: "frozen.txt", LeftPath: "frozen.txt", RightPath: "frozen.txt",
		LeftSize: 5, LeftMod: settled, RightSize: 8, RightMod: settled,
	})

	rep := f.check(t, verify.Opts{})

	if rep.Found != 4 {
		t.Fatalf("this tree was built to produce four kinds of finding, got %v", codes(rep))
	}
	seen := map[string]bool{}
	for _, found := range rep.Findings {
		seen[found.Code] = true
		if found.Code == "" {
			t.Errorf("a finding with no code cannot be translated: %+v", found)
		}
		if found.Path == "" {
			t.Errorf("%q has no path, so nobody can go and look: %+v", found.Code, found)
		}
		if found.Text == "" {
			t.Errorf("%q has no wording, so an interface that does not know it shows a blank", found.Code)
		}
		if strings.Contains(found.Text, "{") {
			t.Errorf("%q left a placeholder unfilled: %q", found.Code, found.Text)
		}
	}
	for _, code := range []string{"agreedButDiffer", "onBothSidesUnrecorded", "recordedButOnNeitherSide", "recordedButOnOneSideOnly"} {
		if !seen[code] {
			t.Errorf("%s was expected from this tree and did not appear: %v", code, codes(rep))
		}
	}
}

// agreeOn2 writes a row for a path that is not on both sides any more, which
// agreeOn cannot do because it reads both files.
func agreeOn2(t *testing.T, f *fixture, path string, leftSize, rightSize int64) {
	t.Helper()
	putRow(t, f, state.Entry{
		Path: path, LeftPath: path, RightPath: path,
		LeftSize: leftSize, LeftMod: settled,
		RightSize: rightSize, RightMod: settled,
	})
}

// TestTheReportSurvivesBeingEncoded pins the JSON the browser reads.
func TestTheReportSurvivesBeingEncoded(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "hello")
	agreeOn(t, f, "a.txt")

	raw, err := json.Marshal(f.check(t, verify.Opts{}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for _, key := range []string{"job", "checksums", "known", "leftFiles", "rightFiles", "checked", "collisions", "found", "returned", "truncated", "findings"} {
		if _, ok := doc[key]; !ok {
			t.Errorf("the report lost its %q field: %s", key, raw)
		}
	}
	// A nil slice would encode as null.
	list, ok := doc["findings"].([]any)
	if !ok {
		t.Fatalf("findings has to arrive as a list, got %T", doc["findings"])
	}
	if len(list) != 0 {
		t.Errorf("nothing is wrong with this job, got %v", list)
	}

	write(t, f.left, "b.txt", "one")
	write(t, f.right, "b.txt", "two and a half")
	putRow(t, f, state.Entry{
		Path: "b.txt", LeftPath: "b.txt", RightPath: "b.txt",
		LeftSize: 3, LeftMod: settled, RightSize: 14, RightMod: settled,
	})
	raw, err = json.Marshal(f.check(t, verify.Opts{}))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	one, ok := doc["findings"].([]any)[0].(map[string]any)
	if !ok {
		t.Fatalf("a finding has to arrive as an object: %s", raw)
	}
	for _, key := range []string{"code", "path", "text", "invisible"} {
		if _, ok := one[key]; !ok {
			t.Errorf("a finding lost its %q field: %s", key, raw)
		}
	}
	if one["invisible"] != true {
		t.Errorf("a frozen disagreement has to reach the screen marked as one: %s", raw)
	}
}
