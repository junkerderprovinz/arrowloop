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

// side is one end of a job: real files behind rclone's local backend, since
// what matters here is how a backend resolves a path.
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

// put writes one file at a remote and, unless stamp is zero, sets its
// modification time.
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

// A move into the trash keeps the file's modification time, so only the run
// identifier says when it was deleted.
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

// A file outside any run directory was put there by hand.
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

// A restore over an occupied name would destroy the newer file with no copy
// left anywhere.
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

	// Both files are exactly as they were.
	if body, _ := s.read(t, "docs/notes.txt"); body != "the new text nobody has a copy of" {
		t.Errorf("the live file was changed by a restore that was refused: %q", body)
	}
	if body, _ := s.read(t, ".arrowloop/trash/20260907-101500/docs/notes.txt"); body != "the old text" {
		t.Errorf("the trashed file was changed by a restore that was refused: %q", body)
	}
}

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

// flaky wraps a real filesystem and makes the first look at one path fail, as
// on Windows when an indexer or virus scanner briefly holds a file (see reread
// in internal/apply).
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

// The failure clears by itself, so without the check rclone's own look a
// moment later would find the newer file and overwrite it.
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

// A backslash escapes the trash only on Windows, so the test asserts the
// refusal rather than that a file survived.
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

// CheckRel stops these inputs before Restore reaches under, so under is tested
// directly.
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

// The location is rebuilt from the path and run the caller sent.
func TestARestoredPathIsNotTakenFromTheListing(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/trash/20260907-101500/docs/notes.txt", "the deleted text", time.Time{})
	s.put(t, "secrets.txt", "not yours", time.Time{})

	// The entry's path with a different run, where nothing is filed.
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
	// A store outside the reserved prefix would be synced to the other side.
	for _, s := range []Store{Trash, LegacyTrash, Versions} {
		if !scan.IsReserved(s.Dir()) {
			t.Errorf("the %s store lives at %q, which the scanner would sync to the other side", s.Name(), s.Dir())
		}
	}
}

func TestTheLegacyTrashIsReachable(t *testing.T) {
	s := newSide(t)
	s.put(t, ".reeveroll/trash/20240101-000000/old.txt", "from an older build", time.Time{})

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
	// Zero is what a request that lost its field decodes to.
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

// The old run holds recently edited files and today's run a file last edited
// in 2019, so pruning by the files' own times would get both wrong.
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
