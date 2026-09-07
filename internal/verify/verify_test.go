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

// Every test here stages a record by hand, and that is worth saying out loud
// once rather than defending in each one.
//
// A test must not build a state the program cannot reach, and a record that
// disagrees with the two sides IS reachable: it is what a restore from a backup
// taken between two runs leaves behind, what a copy of the database from
// another machine looks like, what a crash between the bytes landing and the
// row being written can produce, and what somebody who edited a row by hand to
// unstick a job has made. The apply stage refuses to WRITE such a row, which is
// exactly why nothing else in this program can produce one, and exactly why the
// only way to test the check that finds one is to write it here.

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

// settled is an hour ago, so that nothing these tests write is young enough for
// the engine's quiet period to postpone it. A file the engine would leave alone
// for being half written would make the comparison in TestAFrozenDisagreement
// prove nothing.
var settled = time.Now().Add(-time.Hour).Truncate(time.Second)

// write puts a file on one side and dates it, because the whole comparison
// turns on size and modification time and a test that let the clock decide
// those would be testing the clock.
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

// emptyRecord makes the database without putting anything in it, which is what
// a job whose every row was dropped looks like. The check refuses a job with no
// database at all, so a test about an empty record has to make one.
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

// agreeOn writes the row a finished run would leave for a file that really is
// the same on both sides. The hashes stay empty on purpose: an empty hash means
// "unknown" everywhere in this engine, so the comparison falls back to size and
// time, which is the pair these tests control.
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

// wouldDoNothing runs the real comparison the engine runs and reports what it
// decided. It is here so that the flagship test can prove the claim the whole
// package rests on, that a frozen disagreement is genuinely invisible, rather
// than merely asserting that this package says so.
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

// TestAFrozenDisagreementIsFound is the whole reason this package exists.
//
// Both sides still match their own half of the record, so every run from here
// to the end of time calls them unchanged and reports a success, and the two
// sides hold different files. The engine is asked outright what it would do
// with this tree, because a test that only checked the report would prove that
// this package agrees with itself.
func TestAFrozenDisagreementIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "worldly!")
	// The row that should never have been written: it says the sides agreed,
	// and it describes each of them exactly as it stands.
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

	// The other direction: the same tree with a record that tells the truth
	// about it has nothing to report.
	write(t, f.right, "a.txt", "hello")
	agreeOn(t, f, "a.txt")
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("two sides that really do agree produce no findings, got %v", codes(rep))
	}
}

// TestWhatAChecksumlessCheckCannotSee is the honest half of the checksum
// decision, and it is a test of a limitation rather than of a feature.
//
// Two files of the same length written in the same second are the same file as
// far as size and modification time are concerned, which is exactly the rule
// the engine syncs by. A check without checksums therefore cannot see this
// divergence, and must not be described as if it could; with checksums it is
// found. Both halves are asserted, because a package that quietly read every
// byte of both trees by default would be as wrong as one that claimed to have.
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

// TestARowForAFileOnNeitherSideIsFound covers the record that outlived the
// file, which is what a run interrupted before it could drop the row leaves.
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

	// The other direction: without the stray row the same tree is clean.
	db := openState(t, f)
	if err := db.Forget(context.Background(), "ghost.txt"); err != nil {
		t.Fatalf("forget: %v", err)
	}
	db.Close()
	if rep := f.check(t, verify.Opts{}); rep.Found != 0 {
		t.Errorf("nothing is wrong with this job, got %v", codes(rep))
	}
}

// TestAFileOnBothSidesTheRecordNeverHeardOfIsFound. One of these is two people
// saving the same attachment; a hundred thousand of them is a record that
// belongs to different folders than the ones it is being used for.
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

// TestAFileTheRecordSaysWasOnBothSidesAndIsOnOneIsFound. The record only ever
// holds a path once both sides held it, so a row plus one side always means it
// went away over there. That is a deletion on its way to being propagated and
// it is also a share that half mounted, and this check cannot tell them apart
// from one moment: it says what it sees and says that the next run will act.
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

// TestANewFileOnOneSideIsNotAFinding is the guard against a check nobody would
// keep. A file on one side that the record has never heard of is the single
// most common thing in a working sync job, and reporting it would bury every
// real finding under the ordinary traffic.
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

// TestARowThatContradictsItselfIsFound covers a row whose own two halves
// describe different files. The run that writes a row compares the two sides by
// exactly this rule and refuses to write one that fails it, so a row like this
// never stood for an agreement between anything.
func TestARowThatContradictsItselfIsFound(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "a.txt", "hello")
	write(t, f.right, "a.txt", "hello")
	putRow(t, f, state.Entry{
		Path: "a.txt", LeftPath: "a.txt", RightPath: "a.txt",
		LeftSize: 5, LeftMod: settled,
		// Eight bytes on the right, where five are sitting. The right side has
		// therefore moved on since this row was written, which is what keeps
		// this out of the frozen case above.
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

// TestTheListIsBoundedAndTheTotalIsNot. A tree whose record was wiped produces
// one finding per file, and a browser handed forty thousand of them stops
// responding. The bound is only safe because the totals are not bounded with
// it: a list of five that said nothing about the bound would read exactly like
// a complete list of five.
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

	// Deterministic, which is what makes a bounded list usable at all: an
	// unsorted walk over a map would hand back a different arbitrary five every
	// time, so two checks of an unchanged tree would disagree and nobody could
	// work through the list.
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

// TestAnExcludedFileIsNotReportedAsMissing. A pattern hides its paths from both
// listings while their rows stay in the record, so a check that did not filter
// the record the same way would report every newly excluded file as a row for a
// file nobody has. The engine filters the record in the same place and for a
// harder reason: reading those rows as deletions is how adding one exclude
// pattern destroys the files it was meant to leave alone.
func TestAnExcludedFileIsNotReportedAsMissing(t *testing.T) {
	f := newFixture(t)
	write(t, f.left, "b.txt", "kept")
	write(t, f.right, "b.txt", "kept")
	agreeOn(t, f, "b.txt")
	// *.tmp is excluded by default, so both sides hold this file and neither
	// listing can see it.
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

	// And the check has not simply gone quiet: an identical row whose file the
	// job CAN see, and which really is on neither side, is still reported.
	putRow(t, f, state.Entry{
		Path: "notes.txt", LeftPath: "notes.txt", RightPath: "notes.txt",
		LeftSize: 7, LeftMod: settled, RightSize: 7, RightMod: settled,
	})
	if _, ok := findingFor(f.check(t, verify.Opts{}), "recordedButOnNeitherSide", "notes.txt"); !ok {
		t.Error("a row for a file that is genuinely gone still has to be reported")
	}
}

// TestASideThatListsNothingIsRefusedRatherThanCompared. A share that failed to
// mount lists nothing, and comparing it would produce one finding per recorded
// file: thousands of rows for one fact, and the one fact would be the only
// thing not said. It is also the condition the engine refuses a run for, so the
// same sentence comes back rather than a second wording of it.
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

// TestAJobThatHasNeverRunIsRefusedAndGetsNoDatabase. Opening the record creates
// it, so this check must never be the call that does. A job with no record has
// nothing to hold its sides up against, and answering with one finding per file
// would be thousands of rows about a job with nothing whatsoever the matter
// with it.
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

	// The other direction: with a record in place, the same job answers.
	emptyRecord(t, f)
	if _, err := verify.Check(context.Background(), f.job, verify.Opts{}); err != nil {
		t.Errorf("a job with a record can be checked, got %v", err)
	}
}

// TestCollidingNamesAreLeftOutRatherThanReportedAsMissing. The scanner drops a
// key that two files on one side both claim, because copying them onto a side
// that cannot tell them apart would silently overwrite one with the other. The
// record still holds a row for it, and reporting that row as a file nobody has
// would be a false alarm about a file sitting right there.
//
// Both sides are memory backends because they are case-sensitive on every
// platform, and a local folder on Windows cannot hold the two names this needs.
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
	// A second file that does not collide, on both sides and in the record.
	// Without it the left side lists nothing at all once the colliding key is
	// dropped, and the check refuses the job for that instead: a side holding
	// only files it cannot tell apart is a different problem than this one.
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

	// The other direction, on a tree where the same row really has lost its
	// file on the left: the finding this test suppresses is still produced.
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

// putRemote writes one file into an rclone backend, which is how a memory
// backend gets any content at all.
func putRemote(t *testing.T, remote, name, body string) {
	t.Helper()
	ctx := context.Background()
	f := openFs(t, remote)
	info := object.NewStaticObjectInfo(name, settled, int64(len(body)), true, nil, f)
	if _, err := f.Put(ctx, strings.NewReader(body), info); err != nil {
		t.Fatalf("put %s into %s: %v", name, remote, err)
	}
}

// TestEveryFindingCarriesWordsAndACode. The interface translates from the code
// and falls back to the sentence for a code it has never heard of, so a finding
// with neither is a row nobody can act on.
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

// TestTheReportSurvivesBeingEncoded pins the contract the browser reads. The
// handler does nothing to this structure but hand it to the encoder, so this is
// where a renamed field or a list that quietly became null would show up.
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
	// The one that has actually broken a screen before: a nil slice encodes as
	// null, and a job with nothing wrong is the case a browser meets most.
	list, ok := doc["findings"].([]any)
	if !ok {
		t.Fatalf("findings has to arrive as a list, got %T", doc["findings"])
	}
	if len(list) != 0 {
		t.Errorf("nothing is wrong with this job, got %v", list)
	}

	// And a report that does carry findings keeps their fields.
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
