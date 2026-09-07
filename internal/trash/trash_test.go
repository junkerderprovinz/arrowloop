package trash

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// Everything here runs against a real local filesystem through rclone rather
// than against an imitation of one. The whole subject of this package is what a
// path means once a backend has resolved it, and a fake that resolves paths the
// way the test expects would prove exactly nothing about the case that matters.

// side is one end of a job, made of real files.
type side struct {
	root string
	fs   rclonefs.Fs
}

func newSide(t *testing.T) *side {
	t.Helper()
	root := t.TempDir()
	f, err := rclonefs.NewFs(context.Background(), root)
	if err != nil {
		t.Fatalf("open the side: %v", err)
	}
	return &side{root: root, fs: f}
}

// put writes one file at a remote, creating whatever it needs on the way, and
// stamps it so that a test can tell a file's own age apart from the age of the
// run that filed it.
func (s *side) put(t *testing.T, remote, content string, stamp time.Time) {
	t.Helper()
	full := filepath.Join(s.root, filepath.FromSlash(remote))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", remote, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", remote, err)
	}
	if !stamp.IsZero() {
		if err := os.Chtimes(full, stamp, stamp); err != nil {
			t.Fatalf("stamp %s: %v", remote, err)
		}
	}
}

func (s *side) read(t *testing.T, remote string) (string, bool) {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(s.root, filepath.FromSlash(remote)))
	if errors.Is(err, os.ErrNotExist) {
		return "", false
	}
	if err != nil {
		t.Fatalf("read %s: %v", remote, err)
	}
	return string(body), true
}

func (s *side) exists(t *testing.T, remote string) bool {
	t.Helper()
	_, ok := s.read(t, remote)
	return ok
}

// TestAListingSaysWhenAFileWasDeletedAndNotWhenItWasEdited is the fact the whole
// age half of this package rests on.
//
// A move into the trash preserves the file's modification time, because on a
// local disk it is an os.Rename. So the file's own timestamp says when somebody
// last edited it, which for a deleted document is very often years ago, and it
// says nothing whatever about when it was deleted. The only honest source for
// that is the run identifier the directory is named after.
func TestAListingSaysWhenAFileWasDeletedAndNotWhenItWasEdited(t *testing.T) {
	s := newSide(t)
	edited := time.Date(2019, 3, 4, 5, 6, 7, 0, time.UTC)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "old notes", edited)

	entries, err := List(context.Background(), s.fs, Trash)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("the trash holds one file and the listing has %d entries: %+v", len(entries), entries)
	}
	e := entries[0]
	if e.Path != "docs/notes.txt" {
		t.Errorf("the entry says it came from %q, and restoring it would put it there", e.Path)
	}
	if e.RunID != "20260907-101500" {
		t.Errorf("the run that deleted it is recorded as %q", e.RunID)
	}
	if !e.Known() {
		t.Fatal("the deletion time is unknown for an entry filed under a perfectly ordinary run identifier")
	}
	want := time.Date(2026, 9, 7, 10, 15, 0, 0, time.UTC)
	if !e.Filed.Equal(want) {
		t.Errorf("the deletion is dated %s and the run that did it was %s", e.Filed, want)
	}
	if !e.Modified.Equal(edited) {
		t.Errorf("the file's own time reads %s, and it was last edited %s", e.Modified, edited)
	}
	if e.Filed.Equal(e.Modified) {
		t.Error("the deletion time and the file's own time are the same value, so one of them is standing in for the other")
	}
	if e.Size != int64(len("old notes")) {
		t.Errorf("the entry is %d bytes and the file is %d", e.Size, len("old notes"))
	}
}

// TestAFileNobodyFiledIsStillListed covers the one thing in the trash this
// program did not write.
//
// It cannot come from a run, because a run always files under a run directory.
// Somebody put it there. Leaving it out of the listing would mean telling a
// person their trash holds nothing while their file manager shows a file in it,
// and that is a worse answer than an entry with a blank run.
func TestAFileNobodyFiledIsStillListed(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/loose.txt", "dropped in by hand", time.Time{})

	entries, err := List(context.Background(), s.fs, Trash)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("a file sitting in the trash was left out of the listing: %+v", entries)
	}
	if entries[0].RunID != "" {
		t.Errorf("a file that no run filed was given the run %q", entries[0].RunID)
	}
	if entries[0].Known() {
		t.Error("an entry with no run has a known deletion time, which means something was guessed")
	}
}

// TestRestorePutsTheFileBackWhereItCameFrom is the ordinary case.
func TestRestorePutsTheFileBackWhereItCameFrom(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "the deleted text", time.Time{})

	if err := Restore(context.Background(), s.fs, Trash, "docs/notes.txt", "20260907-101500"); err != nil {
		t.Fatalf("restore: %v", err)
	}
	body, ok := s.read(t, "docs/notes.txt")
	if !ok {
		t.Fatal("the file was not put back")
	}
	if body != "the deleted text" {
		t.Errorf("the file came back holding %q", body)
	}
	if s.exists(t, ".arrowloop/trash/20260907-101500/docs/notes.txt") {
		t.Error("the file is still in the trash as well, so a second restore would be offered for a file that is already back")
	}
}

// TestRestoreRefusesToReplaceWhatIsThereNow is the guard this whole package is
// arranged around.
//
// Every other way this program removes a file leaves a copy somewhere. A restore
// that landed on an occupied name would be the one operation with nothing behind
// it, and the file it destroyed would be the NEWER of the two: somebody deletes a
// document, writes a new one under the same name, then restores the old one out
// of curiosity and loses the new one with no bin to look in.
func TestRestoreRefusesToReplaceWhatIsThereNow(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "the old text", time.Time{})
	s.put(t, "docs/notes.txt", "the new text nobody has a copy of", time.Time{})

	err := Restore(context.Background(), s.fs, Trash, "docs/notes.txt", "20260907-101500")
	var exists *ExistsError
	if !errors.As(err, &exists) {
		t.Fatalf("a restore onto an occupied name was allowed: %v", err)
	}
	if exists.Path != "docs/notes.txt" {
		t.Errorf("the refusal names %q rather than the file it protected", exists.Path)
	}

	// Both files are exactly as they were. A refusal that had already moved
	// something would be worse than no refusal at all.
	if body, _ := s.read(t, "docs/notes.txt"); body != "the new text nobody has a copy of" {
		t.Errorf("the live file was changed by a restore that was refused: %q", body)
	}
	if body, _ := s.read(t, ".arrowloop/trash/20260907-101500/docs/notes.txt"); body != "the old text" {
		t.Errorf("the trashed file was changed by a restore that was refused: %q", body)
	}
}

// TestRestoreRefusesToReplaceAFolderOfTheSameName is the same guard against the
// case where the name is taken by something that is not a file.
func TestRestoreRefusesToReplaceAFolderOfTheSameName(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "the old text", time.Time{})
	s.put(t, "docs/notes.txt/inside.txt", "a folder wearing the name", time.Time{})

	err := Restore(context.Background(), s.fs, Trash, "docs/notes.txt", "20260907-101500")
	var exists *ExistsError
	if !errors.As(err, &exists) {
		t.Fatalf("a restore onto a folder of the same name was not refused: %v", err)
	}
	if !s.exists(t, "docs/notes.txt/inside.txt") {
		t.Error("the folder standing in the way lost its contents")
	}
}

// flaky wraps a real filesystem and makes the first look at one path fail.
//
// This is not an imitation of an awkward backend, it is one. internal/apply
// documents the case at length in reread: on Windows a file that has just been
// closed can be briefly unavailable because an indexer or a virus scanner is
// holding it, so a stat can fail once and succeed a moment later. Everything else
// is delegated to a real local filesystem, so the files under test are genuine.
type flaky struct {
	rclonefs.Fs
	at     string
	failed bool
	err    error
}

func (f *flaky) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	if remote == f.at && !f.failed {
		f.failed = true
		return nil, f.err
	}
	return f.Fs.NewObject(ctx, remote)
}

// TestRestoreRefusesWhenItCouldNotLookAtAll.
//
// "I could not ask" and "nothing is there" are not the same answer, and a restore
// that confused them would overwrite on exactly the runs where the backend was
// having a bad day. The failure here clears by itself, which is what makes the
// test decisive: without the check, rclone's own look at the destination succeeds
// a moment later, finds the newer file and writes straight over it.
func TestRestoreRefusesWhenItCouldNotLookAtAll(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "the old text", time.Time{})
	s.put(t, "docs/notes.txt", "the new text nobody has a copy of", time.Time{})
	shaky := &flaky{Fs: s.fs, at: "docs/notes.txt", err: errors.New("the file is held open by something else")}

	err := Restore(context.Background(), shaky, Trash, "docs/notes.txt", "20260907-101500")
	if err == nil {
		t.Fatal("a restore went ahead on a side that could not answer whether the name was free")
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "the new text nobody has a copy of" {
		t.Errorf("the newer file was overwritten because one look at it failed: %q", body)
	}
	if !s.exists(t, ".arrowloop/trash/20260907-101500/docs/notes.txt") {
		t.Error("the trashed file left the trash on a restore that could not be checked")
	}
}

// TestRestoreRefusesAnythingThatIsNotAPlainRelativePath is the wire guard.
//
// Each of these is refused rather than cleaned. Cleaning "a/../../b" hands back
// something that still escapes, and cleaning "a/../b" hands back a path the
// caller did not ask for, so a restore would land somewhere nobody was told
// about. The backslash cases are the ones that were measured: with a root of
// D:\job\left, the remote ".arrowloop/trash/run/..\..\..\evil" resolves through
// rclone's local backend to D:\job\left\evil, which is outside the trash and
// inside the user's own files. On Linux and macOS the same string escapes
// nothing and is still not a name, which is why the assertion is that the
// request is REFUSED rather than that a particular file survived.
func TestRestoreRefusesAnythingThatIsNotAPlainRelativePath(t *testing.T) {
	cases := []struct {
		what  string
		path  string
		runID string
	}{
		{"a step out of the tree", "../../evil.txt", "20260907-101500"},
		{"a step out of the tree in the middle", "docs/../../evil.txt", "20260907-101500"},
		{"a bare parent", "..", "20260907-101500"},
		{"a rooted path", "/etc/passwd", "20260907-101500"},
		{"a drive-rooted path", "C:/Windows/evil.txt", "20260907-101500"},
		{"a drive-relative path", "c:evil.txt", "20260907-101500"},
		{"a backslash walk, which is a separator on Windows", `..\..\evil.txt`, "20260907-101500"},
		{"a backslash anywhere at all", `docs\notes.txt`, "20260907-101500"},
		{"an empty path", "", "20260907-101500"},
		{"a zero byte, which truncates the name below here", "docs/notes\x00.txt", "20260907-101500"},
		{"a run identifier that is a path", "docs/notes.txt", "../../.."},
		{"a run identifier with a separator", "docs/notes.txt", "2026/09"},
		{"a run identifier with a backslash", "docs/notes.txt", `..\..`},
		{"an empty run identifier", "docs/notes.txt", ""},
		{"a destination inside the reserved directory", ".arrowloop/anything.txt", "20260907-101500"},
		{"a destination inside the old reserved directory", ".reeveroll/anything.txt", "20260907-101500"},
	}
	for _, c := range cases {
		t.Run(c.what, func(t *testing.T) {
			s := newSide(t)
			err := Restore(context.Background(), s.fs, Trash, c.path, c.runID)
			if err == nil {
				t.Fatalf("%q with run %q was accepted as a name inside the trash", c.path, c.runID)
			}
			if !errors.Is(err, ErrNotAName) {
				t.Fatalf("the refusal of %q does not read as a bad name, so a caller cannot answer it correctly: %v", c.path, err)
			}
		})
	}
}

// TestUnderRefusesAPartThatWalksOutOfTheDirectory drives the last line of the
// path check directly.
//
// It cannot be reached through Restore or RestoreVersion, because CheckRel
// refuses every input that would get this far, and a test that tried to reach it
// through them would be building a state the program cannot be in. It is tested
// here as the unit it is: under() is what a fourth entry point will reach for
// one day, and this says what it does when the caller before it forgot to check.
func TestUnderRefusesAPartThatWalksOutOfTheDirectory(t *testing.T) {
	if _, err := under(scan.TrashDir, "..", "evil.txt"); !errors.Is(err, ErrNotAName) {
		t.Errorf("a part walking out of the trash was joined onto it anyway: %v", err)
	}
	if _, err := under(scan.TrashDir, "run", "../../../evil.txt"); !errors.Is(err, ErrNotAName) {
		t.Errorf("a nested walk out of the trash was joined onto it anyway: %v", err)
	}
	got, err := under(scan.TrashDir, "20260907-101500", "docs/notes.txt")
	if err != nil {
		t.Fatalf("an ordinary entry was refused: %v", err)
	}
	if got != scan.TrashDir+"/20260907-101500/docs/notes.txt" {
		t.Errorf("an ordinary entry was assembled as %q", got)
	}
}

// TestARestoredPathIsNotTakenFromTheListing proves the location is rebuilt from
// the two values the caller sent rather than trusted as it arrives.
//
// The listing hands back a remote because a person may want to find the file
// themselves. By the time that string comes back it is whatever the caller chose
// to send, and a remote this program once produced is not evidence of anything.
func TestARestoredPathIsNotTakenFromTheListing(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "the deleted text", time.Time{})
	s.put(t, "secrets.txt", "not yours", time.Time{})

	// The entry's own path, but a run identifier naming a different run. Nothing
	// is at the assembled location, so this must fail to find a file rather than
	// reaching for the one the listing happened to mention.
	err := Restore(context.Background(), s.fs, Trash, "docs/notes.txt", "20200101-000000")
	if err == nil {
		t.Fatal("an entry that is not in the named run was restored anyway")
	}
	if !errors.Is(err, rclonefs.ErrorObjectNotFound) {
		t.Errorf("the failure reads as %v rather than as nothing being there", err)
	}
	if s.exists(t, "docs/notes.txt") {
		t.Error("a file appeared at the destination of a restore that failed")
	}
}

func TestStoreNamedIsAClosedSet(t *testing.T) {
	for _, want := range []Store{Trash, LegacyTrash, Versions} {
		got, ok := StoreNamed(want.Name())
		if !ok || got.Dir() != want.Dir() {
			t.Errorf("%q did not resolve back to itself", want.Name())
		}
	}
	for _, name := range []string{"", "..", "/etc", ".arrowloop", "TRASH", "trash/../.."} {
		if _, ok := StoreNamed(name); ok {
			t.Errorf("%q was accepted as the name of a reserved directory", name)
		}
	}
	// Everything a store points at has to be somewhere the scanner already
	// skips. A store outside the reserved prefix would be synced to the other
	// side, where it would land inside that side's reserved rules and stay for
	// ever, which is the failure internal/scan's legacy comment describes.
	for _, s := range []Store{Trash, LegacyTrash, Versions} {
		if !scan.IsReserved(s.Dir()) {
			t.Errorf("the %s store lives at %q, which the scanner would sync to the other side", s.Name(), s.Dir())
		}
	}
}

// TestTheLegacyTrashIsReachable covers the trash an older build wrote. The files
// in it are somebody's deleted files whatever the folder above them is called.
func TestTheLegacyTrashIsReachable(t *testing.T) {
	s := newSide(t)
	s.put(t, ".reeveroll/trash/20240101-000000/old.txt", "from before the rename", time.Time{})

	entries, err := List(context.Background(), s.fs, LegacyTrash)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 || entries[0].Path != "old.txt" {
		t.Fatalf("the old trash was not read: %+v", entries)
	}
	if err := Restore(context.Background(), s.fs, LegacyTrash, "old.txt", "20240101-000000"); err != nil {
		t.Fatalf("restore from the old trash: %v", err)
	}
	if !s.exists(t, "old.txt") {
		t.Error("a file from the old trash was not put back")
	}
}

// TestAnEmptyTrashIsNotAFailure. A job whose trash has never been written is the
// ordinary case, and on a bucket backend the directory does not exist as a thing
// at all.
func TestAnEmptyTrashIsNotAFailure(t *testing.T) {
	s := newSide(t)
	entries, err := List(context.Background(), s.fs, Trash)
	if err != nil {
		t.Fatalf("a side with no trash reported a failure: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("a side with no trash listed %d entries", len(entries))
	}
}

func TestCheckRelAcceptsTheNamesRealFilesHave(t *testing.T) {
	for _, ok := range []string{
		"notes.txt",
		"docs/notes.txt",
		"a/b/c/d/e.txt",
		"holiday photos/2019-07-01 12:30:00.jpg",
		".hidden/file",
		"..leading-dots.txt",
		"trailing..",
	} {
		if _, err := CheckRel(ok); err != nil {
			t.Errorf("%q is a name a real file can have and it was refused: %v", ok, err)
		}
	}
}

func TestCutoffRefusesAnAgeThatMeansEverything(t *testing.T) {
	now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
	// Zero is what a request that lost its field decodes to, and it would empty
	// the whole trash while looking exactly like a request to tidy it.
	for _, days := range []int{0, -1, -3650} {
		if _, err := Cutoff(now, days); err == nil {
			t.Errorf("%d days was accepted as an age to prune by", days)
		}
	}
	got, err := Cutoff(now, 30)
	if err != nil {
		t.Fatalf("thirty days was refused: %v", err)
	}
	if want := now.AddDate(0, 0, -30); !got.Equal(want) {
		t.Errorf("thirty days back from %s came out as %s rather than %s", now, got, want)
	}
}

func TestPruneRefusesTheVersionsStore(t *testing.T) {
	s := newSide(t)
	_, err := PruneOlderThan(context.Background(), s.fs, Versions, time.Now())
	if err == nil {
		t.Fatal("the versions store was pruned by age, and it is filed by path rather than by run")
	}
	if !strings.Contains(err.Error(), "versions") {
		t.Errorf("the refusal does not say which store it is about: %v", err)
	}
}

// TestPruningGoesByTheRunAndNeverByTheFilesOwnTime is the other half of the age
// question, and it is the one that destroys data when it is wrong.
//
// The two files are arranged so that the two possible answers disagree
// completely. The old run holds a file edited a minute ago, and today's run holds
// a file last edited in 2019. Pruning on the file's own time would keep the first
// and destroy the second, which is the deleted-this-morning document somebody
// wanted back.
func TestPruningGoesByTheRunAndNeverByTheFilesOwnTime(t *testing.T) {
	s := newSide(t)
	now := time.Now().UTC()
	today := now.Format(RunIDLayout)

	s.put(t, ".arrowloop/trash/20200101-000000/deleted-long-ago.txt", "x", now)
	s.put(t, ".arrowloop/trash/20200101-000000/also-long-ago.txt", "yy", now)
	s.put(t, ".arrowloop/trash/"+today+"/deleted-just-now.txt", "zzz", time.Date(2019, 1, 1, 0, 0, 0, 0, time.UTC))

	cutoff, err := Cutoff(now, 30)
	if err != nil {
		t.Fatalf("cutoff: %v", err)
	}
	pruned, err := PruneOlderThan(context.Background(), s.fs, Trash, cutoff)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}

	if s.exists(t, ".arrowloop/trash/20200101-000000/deleted-long-ago.txt") ||
		s.exists(t, ".arrowloop/trash/20200101-000000/also-long-ago.txt") {
		t.Error("a run from 2020 survived a prune of everything older than thirty days")
	}
	if !s.exists(t, ".arrowloop/trash/"+today+"/deleted-just-now.txt") {
		t.Error("a file deleted today was pruned, because its own modification time is from 2019")
	}
	if len(pruned.Runs) != 1 || pruned.Runs[0] != "20200101-000000" {
		t.Errorf("the prune reports removing the runs %v", pruned.Runs)
	}
	if pruned.Entries != 2 {
		t.Errorf("the prune reports %d entries removed and it removed two", pruned.Entries)
	}
	if pruned.Bytes != 3 {
		t.Errorf("the prune reports %d bytes freed and the two files were three", pruned.Bytes)
	}
}

// TestPruningNeverTouchesAnEntryWhoseAgeIsUnknown. There is no bin behind a
// prune, and the only other time available is the file's own, which for a
// deleted file says when it was last edited. An unknown age means no.
func TestPruningNeverTouchesAnEntryWhoseAgeIsUnknown(t *testing.T) {
	s := newSide(t)
	ancient := time.Date(1999, 1, 1, 0, 0, 0, 0, time.UTC)
	s.put(t, ".arrowloop/trash/loose.txt", "nobody filed this", ancient)
	s.put(t, ".arrowloop/trash/not-a-timestamp/kept.txt", "nor this", ancient)

	cutoff, err := Cutoff(time.Now(), 1)
	if err != nil {
		t.Fatalf("cutoff: %v", err)
	}
	pruned, err := PruneOlderThan(context.Background(), s.fs, Trash, cutoff)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if !s.exists(t, ".arrowloop/trash/loose.txt") {
		t.Error("a file with no run was removed on the strength of its own modification time")
	}
	if !s.exists(t, ".arrowloop/trash/not-a-timestamp/kept.txt") {
		t.Error("a run whose name is not a timestamp was removed on the strength of a file's modification time")
	}
	if pruned.Unknown != 2 {
		t.Errorf("the prune reports %d entries of unknown age, and it left two alone", pruned.Unknown)
	}
	if len(pruned.Runs) != 0 {
		t.Errorf("the prune reports removing %v", pruned.Runs)
	}
}
