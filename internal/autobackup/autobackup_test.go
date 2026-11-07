package autobackup

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

var noon = time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)

func TestABackupIsTheFileByteForByte(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "backups")
	doc := []byte("{\n  \"jobs\": [],\n  \"unknownKey\": \"kept\"\n}\n")

	f, wrote, err := Save(dir, doc, noon, 7)
	if err != nil {
		t.Fatal(err)
	}
	if !wrote {
		t.Fatal("the first backup was not written")
	}
	if f.Name != "arrowloop-auto-20261107-120000.json" || !f.Made.Equal(noon) {
		t.Errorf("the backup is %+v", f)
	}
	got, err := Read(dir, f.Name)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, doc) {
		t.Errorf("the backup holds %q, not the file", got)
	}
}

// The file carries the notification secrets, as the export does, so only the
// account running ArrowLoop may read it.
func TestABackupIsReadableByItsOwnerAlone(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no permission bits to check")
	}
	dir := t.TempDir()
	f, _, err := Save(dir, []byte(`{"jobs":[]}`), noon, 7)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, f.Name))
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("the backup has mode %v", mode)
	}
}

// Seven copies of an unchanged file would hold one week of history; seven
// different ones reach back as far as the edits do.
func TestAnUnchangedFileIsNotWrittenAgain(t *testing.T) {
	dir := t.TempDir()
	doc := []byte(`{"jobs":[]}`)
	if _, _, err := Save(dir, doc, noon, 7); err != nil {
		t.Fatal(err)
	}
	f, wrote, err := Save(dir, doc, noon.Add(24*time.Hour), 7)
	if err != nil {
		t.Fatal(err)
	}
	if wrote {
		t.Error("an unchanged file was written again")
	}
	if !f.Made.Equal(noon) {
		t.Errorf("the newest backup should still be the first one, got %+v", f)
	}
	files, _ := List(dir)
	if len(files) != 1 {
		t.Errorf("there are %d backups", len(files))
	}
}

func TestOnlyTheNewestAreKept(t *testing.T) {
	dir := t.TempDir()
	for day := range 5 {
		doc := fmt.Appendf(nil, `{"jobs":[],"day":%d}`, day)
		if _, _, err := Save(dir, doc, noon.AddDate(0, 0, day), 3); err != nil {
			t.Fatal(err)
		}
	}
	files, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("%d backups are kept, not 3", len(files))
	}
	for i, f := range files {
		if want := noon.AddDate(0, 0, 4-i); !f.Made.Equal(want) {
			t.Errorf("backup %d was made %v, want %v", i, f.Made, want)
		}
	}
}

// The folder may be one somebody also keeps their own exports in.
func TestOtherFilesInTheFolderAreLeftAlone(t *testing.T) {
	dir := t.TempDir()
	mine := []string{"arrowloop-2026-11-01.json", "notes.txt", "arrowloop-auto-yesterday.json"}
	for _, name := range mine {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for day := range 3 {
		doc := fmt.Appendf(nil, `{"day":%d}`, day)
		if _, _, err := Save(dir, doc, noon.AddDate(0, 0, day), 1); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range mine {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s is gone: %v", name, err)
		}
	}
}

// A run killed halfway leaves a temporary file that must neither count as a
// backup nor stay for ever.
func TestAnUnfinishedBackupIsClearedAway(t *testing.T) {
	dir := t.TempDir()
	left := filepath.Join(dir, ".arrowloop-auto-20261106-120000.json.tmp")
	if err := os.WriteFile(left, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	files, _ := List(dir)
	if len(files) != 0 {
		t.Errorf("an unfinished file is listed: %+v", files)
	}
	if _, _, err := Save(dir, []byte(`{}`), noon, 7); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(left); !os.IsNotExist(err) {
		t.Errorf("the unfinished file is still there: %v", err)
	}
}

func TestAFolderNotMadeYetHoldsNoBackups(t *testing.T) {
	files, err := List(filepath.Join(t.TempDir(), "not-yet"))
	if err != nil || len(files) != 0 {
		t.Errorf("got %v, %v", files, err)
	}
}

// The name arrives from a request, so it must never reach anything but a
// backup in the folder.
func TestOnlyABackupsOwnNameIsRead(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "secret.json"), []byte("{}"), 0o600)
	for _, name := range []string{
		"secret.json",
		"../arrowloop.json",
		"arrowloop-auto-20261107-120000.json/../../secret.json",
		"arrowloop-auto-2026110-120000.json",
		"",
	} {
		if _, err := Read(dir, name); err == nil {
			t.Errorf("%q was read", name)
		}
	}
}

func TestTheNextBackupIsDueAfterTheNewestOrTheLastLook(t *testing.T) {
	day := 24 * time.Hour
	files := []File{{Made: noon}}
	cases := []struct {
		name    string
		files   []File
		checked time.Time
		want    time.Time
	}{
		{"none yet is due at once", nil, time.Time{}, time.Time{}},
		{"a day after the newest", files, time.Time{}, noon.Add(day)},
		{"a day after a look that found nothing new", files, noon.Add(30 * time.Hour), noon.Add(54 * time.Hour)},
		{"an older look changes nothing", files, noon.Add(-time.Hour), noon.Add(day)},
	}
	for _, c := range cases {
		if got := Next(c.files, c.checked, day); !got.Equal(c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestAFolderThatCannotBeWrittenIsRefused(t *testing.T) {
	file := filepath.Join(t.TempDir(), "a-file")
	os.WriteFile(file, []byte("x"), 0o600)
	if err := Writable(filepath.Join(file, "backups")); err == nil {
		t.Error("a folder inside a file was accepted")
	}
}

// The settings save as somebody types, so the check must not leave a trail of
// half-typed folders behind.
func TestCheckingAFolderLeavesNothingBehind(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "new", "backups")
	if err := Writable(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "new")); !os.IsNotExist(err) {
		t.Errorf("the check left %s behind", filepath.Join(root, "new"))
	}

	if err := Writable(root); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Errorf("the check left %v in an existing folder", entries)
	}
}
