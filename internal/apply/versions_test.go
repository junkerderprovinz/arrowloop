package apply

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/trash"
)

// versionSide is a real local filesystem, because what is tested is what a
// backend does with a path.
type versionSide struct {
	root string
	fs   rclonefs.Fs
}

func newVersionSide(t *testing.T) *versionSide {
	t.Helper()
	root := t.TempDir()
	f, err := rclonefs.NewFs(context.Background(), root)
	if err != nil {
		t.Fatalf("open the side: %v", err)
	}
	return &versionSide{root: root, fs: f}
}

func (s *versionSide) write(t *testing.T, remote, content string) {
	t.Helper()
	full := filepath.Join(s.root, filepath.FromSlash(remote))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", remote, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", remote, err)
	}
}

func (s *versionSide) read(t *testing.T, remote string) (string, bool) {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(s.root, filepath.FromSlash(remote)))
	if err != nil {
		return "", false
	}
	return string(body), true
}

func (s *versionSide) versions(t *testing.T) []trash.Entry {
	t.Helper()
	entries, err := trash.List(context.Background(), s.fs, trash.Versions)
	if err != nil {
		t.Fatalf("list the versions: %v", err)
	}
	return entries
}

func TestARunThatWasNeverToldToKeepVersionsKeepsNone(t *testing.T) {
	s := newVersionSide(t)
	s.write(t, "docs/notes.txt", "the file about to be replaced")

	if err := keepVersion(context.Background(), s.fs, "docs/notes.txt", "20260907-101500"); err != nil {
		t.Fatalf("a run with no versioning setting failed: %v", err)
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "the file about to be replaced" {
		t.Errorf("the live file was moved by a run that never asked for versions: %q", body)
	}
	if kept := s.versions(t); len(kept) != 0 {
		t.Errorf("a run that never asked for versions kept %d: %+v", len(kept), kept)
	}
}

func TestVersionsKeptReadsBackWhatTheRunWasTold(t *testing.T) {
	if got := versionsKept(context.Background()); got != 0 {
		t.Errorf("a run that was told nothing keeps %d versions", got)
	}
	for _, want := range []int{0, 1, 5, 100} {
		if got := versionsKept(WithVersions(context.Background(), want)); got != want {
			t.Errorf("a run told to keep %d reads back %d", want, got)
		}
	}
	// Two runs at once under parallelJobs keep their own answers.
	one := WithVersions(context.Background(), 3)
	two := WithVersions(context.Background(), 7)
	if versionsKept(one) != 3 || versionsKept(two) != 7 {
		t.Errorf("two runs share one setting: %d and %d", versionsKept(one), versionsKept(two))
	}
}

func TestTheOldFileIsSetAsideBeforeTheCopyLandsOnIt(t *testing.T) {
	s := newVersionSide(t)
	s.write(t, "docs/notes.txt", "the file about to be replaced")

	ctx := WithVersions(context.Background(), 3)
	if err := keepVersion(ctx, s.fs, "docs/notes.txt", "20260907-101500"); err != nil {
		t.Fatalf("keep: %v", err)
	}
	if _, still := s.read(t, "docs/notes.txt"); still {
		t.Error("the old file is still at the live path, so the copy that follows would not be an overwrite")
	}

	kept := s.versions(t)
	if len(kept) != 1 {
		t.Fatalf("one file was replaced and %d versions were kept: %+v", len(kept), kept)
	}
	// The scanner skips the reserved prefix, so the version never travels.
	if !scan.IsReserved(kept[0].Remote) {
		t.Errorf("the version went to %q, which the next run would sync to the other side", kept[0].Remote)
	}
	if kept[0].Path != "docs/notes.txt" {
		t.Errorf("the version says it came from %q", kept[0].Path)
	}
	if kept[0].RunID != "20260907-101500" {
		t.Errorf("the version is filed under the run %q, and the run that replaced the file was 20260907-101500", kept[0].RunID)
	}
	if body, _ := s.read(t, kept[0].Remote); body != "the file about to be replaced" {
		t.Errorf("the kept version holds %q", body)
	}
}

func TestTheHistoryStopsAtTheNumberAsked(t *testing.T) {
	s := newVersionSide(t)
	ctx := WithVersions(context.Background(), 2)
	for _, run := range []string{"20260901-000000", "20260902-000000", "20260903-000000", "20260904-000000"} {
		s.write(t, "docs/notes.txt", "the text as of "+run)
		if err := keepVersion(ctx, s.fs, "docs/notes.txt", run); err != nil {
			t.Fatalf("keep %s: %v", run, err)
		}
	}

	kept := s.versions(t)
	if len(kept) != 2 {
		t.Fatalf("two versions were asked for and %d are kept: %+v", len(kept), kept)
	}
	for i, run := range []string{"20260904-000000", "20260903-000000"} {
		if kept[i].RunID != run {
			t.Errorf("version %d is from %q, and the newest two are 20260904-000000 and 20260903-000000", i, kept[i].RunID)
		}
	}
}

// Most copies put a file where there was none.
func TestAFileArrivingForTheFirstTimeIsNotAFailure(t *testing.T) {
	s := newVersionSide(t)
	ctx := WithVersions(context.Background(), 3)
	if err := keepVersion(ctx, s.fs, "docs/brand-new.txt", "20260907-101500"); err != nil {
		t.Fatalf("a file that is not there yet was reported as a failure to version: %v", err)
	}
	if kept := s.versions(t); len(kept) != 0 {
		t.Errorf("a file that was not there produced %d versions", len(kept))
	}
}

// A plain file where the versions directory has to be stays for good, since
// the scanner skips the reserved prefix.
func TestAVersionThatCouldNotBeKeptStopsTheOverwrite(t *testing.T) {
	s := newVersionSide(t)
	s.write(t, "docs/notes.txt", "the file about to be replaced")
	s.write(t, ".arrowloop/versions/docs/notes.txt", "a plain file where a folder has to go")

	ctx := WithVersions(context.Background(), 3)
	if err := keepVersion(ctx, s.fs, "docs/notes.txt", "20260907-101500"); err == nil {
		t.Fatal("a version that could not be kept was reported as kept, so the overwrite would have gone ahead")
	}
	if body, _ := s.read(t, "docs/notes.txt"); body != "the file about to be replaced" {
		t.Errorf("the live file was moved by a keep that failed: %q", body)
	}
}
