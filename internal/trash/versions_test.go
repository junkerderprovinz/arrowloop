package trash

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// TestKeepingVersionsIsOffUntilSomebodyAsks.
//
// Keeping versions doubles what a busy tree holds, silently, inside the tree
// itself. A sync tool that started eating disk space on an upgrade is a sync tool
// nobody upgrades again, so nothing at all may happen until a number is set.
func TestKeepingVersionsIsOffUntilSomebodyAsks(t *testing.T) {
	for _, keep := range []int{0, -1} {
		s := newSide(t)
		s.put(t, "docs/notes.txt", "the version about to be replaced", time.Time{})

		if err := KeepVersion(context.Background(), s.fs, "docs/notes.txt", "20260907-101500", keep); err != nil {
			t.Fatalf("keep %d: %v", keep, err)
		}
		if body, _ := s.read(t, "docs/notes.txt"); body != "the version about to be replaced" {
			t.Errorf("keep %d moved the live file: %q", keep, body)
		}
		entries, err := List(context.Background(), s.fs, Versions)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(entries) != 0 {
			t.Errorf("keep %d wrote %d versions, and nobody asked for any", keep, len(entries))
		}
	}
}

// TestAKeptVersionGoesWhereTheScannerWillNotLook is the property the whole
// feature rests on, and it is inherited from toTrash rather than invented here.
//
// A copy left anywhere else inside the synced tree would be synced to the other
// side on the next run, where it would land inside that side's own reserved
// rules and stay for ever. Outside the tree is not an option, because on an S3
// bucket or an SFTP export there is often no outside.
func TestAKeptVersionGoesWhereTheScannerWillNotLook(t *testing.T) {
	s := newSide(t)
	s.put(t, "docs/notes.txt", "the version about to be replaced", time.Time{})

	if err := KeepVersion(context.Background(), s.fs, "docs/notes.txt", "20260907-101500", 3); err != nil {
		t.Fatalf("keep: %v", err)
	}
	if s.exists(t, "docs/notes.txt") {
		t.Error("the old file is still at the live path, so the copy that follows would not have been an overwrite at all")
	}

	entries, err := List(context.Background(), s.fs, Versions)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("one file was set aside and %d versions were listed: %+v", len(entries), entries)
	}
	e := entries[0]
	if !scan.IsReserved(e.Remote) {
		t.Errorf("the version was put at %q, which the scanner would sync to the other side", e.Remote)
	}
	if e.Path != "docs/notes.txt" {
		t.Errorf("the version says it came from %q, so restoring it would put it there", e.Path)
	}
	if e.RunID != "20260907-101500" {
		t.Errorf("the version is filed under the run %q", e.RunID)
	}
	if !strings.HasSuffix(e.Remote, ".txt") {
		t.Errorf("the version is stored as %q, and a file manager cannot open it as what it is", e.Remote)
	}
	if body, ok := s.read(t, e.Remote); !ok || body != "the version about to be replaced" {
		t.Errorf("the kept version holds %q", body)
	}
}

// TestNothingToOverwriteIsNotAFailure. A file arriving on a side for the first
// time is the ordinary case, and treating it as a failed version would turn every
// new file into a skipped copy.
func TestNothingToOverwriteIsNotAFailure(t *testing.T) {
	s := newSide(t)
	if err := KeepVersion(context.Background(), s.fs, "docs/notes.txt", "20260907-101500", 3); err != nil {
		t.Fatalf("keeping a version of a file that is not there failed: %v", err)
	}
	entries, err := List(context.Background(), s.fs, Versions)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("a file that was not there produced %d versions", len(entries))
	}
}

// TestTheHistoryIsPrunedToTheNumberAsked is the second half of the setting. A
// history that only ever grows is a disk that only ever fills.
func TestTheHistoryIsPrunedToTheNumberAsked(t *testing.T) {
	s := newSide(t)
	ctx := context.Background()
	runs := []string{"20260901-000000", "20260902-000000", "20260903-000000", "20260904-000000", "20260905-000000"}
	for _, run := range runs {
		s.put(t, "docs/notes.txt", "the text as of "+run, time.Time{})
		if err := KeepVersion(ctx, s.fs, "docs/notes.txt", run, 3); err != nil {
			t.Fatalf("keep %s: %v", run, err)
		}
	}

	entries, err := List(ctx, s.fs, Versions)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("three versions were asked for and %d are kept: %+v", len(entries), entries)
	}
	// The listing is newest first, and the newest three are the last three
	// written. Keeping an arbitrary three would satisfy a count and lose the
	// only versions anybody wants.
	want := []string{"20260905-000000", "20260904-000000", "20260903-000000"}
	for i, run := range want {
		if entries[i].RunID != run {
			t.Errorf("version %d is from run %q and the newest three are %v", i, entries[i].RunID, want)
		}
	}
	for _, gone := range []string{"20260901-000000", "20260902-000000"} {
		for _, e := range entries {
			if e.RunID == gone {
				t.Errorf("the version from %s should have been pruned", gone)
			}
		}
	}
}

// TestOneFilesHistoryDoesNotPruneAnother. Versions are filed under the path
// precisely so that keeping the last three of one file is one listing of one
// directory, and a prune that reached wider would delete a neighbour's history to
// satisfy a count that was never about it.
func TestOneFilesHistoryDoesNotPruneAnother(t *testing.T) {
	s := newSide(t)
	ctx := context.Background()
	for _, run := range []string{"20260901-000000", "20260902-000000"} {
		for _, name := range []string{"docs/one.txt", "docs/two.txt"} {
			s.put(t, name, "the text as of "+run, time.Time{})
			if err := KeepVersion(ctx, s.fs, name, run, 1); err != nil {
				t.Fatalf("keep %s at %s: %v", name, run, err)
			}
		}
	}

	entries, err := List(ctx, s.fs, Versions)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("two files each keeping one version produced %d versions: %+v", len(entries), entries)
	}
	seen := map[string]bool{}
	for _, e := range entries {
		seen[e.Path] = true
		if e.RunID != "20260902-000000" {
			t.Errorf("%s kept the version from %q rather than the newest", e.Path, e.RunID)
		}
	}
	for _, name := range []string{"docs/one.txt", "docs/two.txt"} {
		if !seen[name] {
			t.Errorf("%s has no history left, so pruning one file reached into another", name)
		}
	}
}

// TestAFailureToKeepAVersionReachesTheCaller.
//
// The state is reachable and is not contrived: a plain file sitting where the
// versions directory for docs/notes.txt has to be. Nothing removes it, because
// the scanner skips the whole reserved prefix, so once it exists on a side it
// stays there. What matters is that the failure comes back rather than being
// swallowed: internal/apply turns it into a skip and the overwrite does not
// happen, which is the outcome somebody who asked for versions wants. Swallowing
// it would hand them an overwrite with no version kept, which is exactly what the
// setting exists to prevent.
func TestAFailureToKeepAVersionReachesTheCaller(t *testing.T) {
	s := newSide(t)
	s.put(t, "docs/notes.txt", "the version about to be replaced", time.Time{})
	s.put(t, ".arrowloop/versions/docs/notes.txt", "a plain file where a folder has to go", time.Time{})

	err := KeepVersion(context.Background(), s.fs, "docs/notes.txt", "20260907-101500", 3)
	if err == nil {
		t.Fatal("a version that could not be kept was reported as kept, so the overwrite would go ahead")
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "the version about to be replaced" {
		t.Errorf("the live file was moved by a keep that failed: %q", body)
	}
}

// TestRestoringAVersionKeepsWhatItReplaces.
//
// This is the one restore allowed to land on an occupied name, and it is allowed
// only because it puts a bin behind itself first. The rule is not "never
// overwrite", it is "never destroy something with nothing behind it". Refusing
// outright instead would refuse every single time, since the live file is always
// there, and the feature would be unreachable.
func TestRestoringAVersionKeepsWhatItReplaces(t *testing.T) {
	s := newSide(t)
	ctx := context.Background()
	s.put(t, ".arrowloop/versions/docs/notes.txt/20260901-000000.txt", "yesterday", time.Time{})
	s.put(t, "docs/notes.txt", "today, which nobody has another copy of", time.Time{})

	now := time.Date(2026, 9, 7, 10, 15, 0, 0, time.UTC)
	if err := RestoreVersion(ctx, s.fs, "docs/notes.txt", "20260901-000000", now); err != nil {
		t.Fatalf("restore a version: %v", err)
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "yesterday" {
		t.Errorf("the live file holds %q after restoring yesterday's version", body)
	}
	if body, ok := s.read(t, ".arrowloop/versions/docs/notes.txt/20260907-101500.txt"); !ok || body != "today, which nobody has another copy of" {
		t.Errorf("the file that was replaced was not kept: %q", body)
	}
	// The version that was restored stays in the history. Moving it out would
	// mean restoring a version costs you that version.
	if body, ok := s.read(t, ".arrowloop/versions/docs/notes.txt/20260901-000000.txt"); !ok || body != "yesterday" {
		t.Errorf("the restored version left the history: %q", body)
	}
}

// TestRestoringAVersionOntoNothingKeepsNothing. Somebody deleting a file and then
// asking for a version of it back is an ordinary way to arrive here, and there
// is nothing to preserve.
func TestRestoringAVersionOntoNothingKeepsNothing(t *testing.T) {
	s := newSide(t)
	s.put(t, ".arrowloop/versions/docs/notes.txt/20260901-000000.txt", "yesterday", time.Time{})

	now := time.Date(2026, 9, 7, 10, 15, 0, 0, time.UTC)
	if err := RestoreVersion(context.Background(), s.fs, "docs/notes.txt", "20260901-000000", now); err != nil {
		t.Fatalf("restore a version: %v", err)
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "yesterday" {
		t.Errorf("the live file holds %q", body)
	}
	entries, err := List(context.Background(), s.fs, Versions)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("restoring onto an empty name kept %d versions", len(entries))
	}
}

// TestRestoringAVersionRefusesAnythingThatIsNotAPlainRelativePath. The same wire
// guard as the trash, because it is the same wire.
func TestRestoringAVersionRefusesAnythingThatIsNotAPlainRelativePath(t *testing.T) {
	cases := []struct {
		path  string
		runID string
	}{
		{"../../evil.txt", "20260901-000000"},
		{`..\..\evil.txt`, "20260901-000000"},
		{"/etc/passwd", "20260901-000000"},
		{".arrowloop/anything.txt", "20260901-000000"},
		{"docs/notes.txt", "../.."},
		{"docs/notes.txt", ""},
	}
	now := time.Now()
	for _, c := range cases {
		s := newSide(t)
		err := RestoreVersion(context.Background(), s.fs, c.path, c.runID, now)
		if !errors.Is(err, ErrNotAName) {
			t.Errorf("%q with run %q was accepted: %v", c.path, c.runID, err)
		}
	}
}

// TestAMissingVersionIsSaidPlainly rather than silently doing nothing.
func TestAMissingVersionIsSaidPlainly(t *testing.T) {
	s := newSide(t)
	s.put(t, "docs/notes.txt", "today", time.Time{})

	err := RestoreVersion(context.Background(), s.fs, "docs/notes.txt", "20200101-000000", time.Now())
	if !errors.Is(err, rclonefs.ErrorObjectNotFound) {
		t.Fatalf("asking for a version that was never kept answered %v", err)
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "today" {
		t.Errorf("the live file was changed by a restore that found nothing: %q", body)
	}
	entries, err := List(context.Background(), s.fs, Versions)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("a request that could never succeed wrote %d versions on its way to failing: %+v", len(entries), entries)
	}
}
