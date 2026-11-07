package autobackup

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
	_ "time/tzdata"
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

func vienna(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Vienna")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestTheNextBackupIsDueAtItsTimeOnTheDayItsDaysComeRound(t *testing.T) {
	loc := vienna(t)
	at := func(month time.Month, day, hour, minute int) time.Time {
		return time.Date(2026, month, day, hour, minute, 0, 0, loc)
	}
	made := func(t time.Time) []File { return []File{{Made: t.UTC()}} }
	daily := Schedule{EveryDays: 1, Hour: 3}
	cases := []struct {
		name     string
		files    []File
		checked  time.Time
		schedule Schedule
		want     time.Time
	}{
		{"none yet is due at once", nil, time.Time{}, daily, time.Time{}},
		{"the next morning", made(at(11, 7, 3, 0)), time.Time{}, daily, at(11, 8, 3, 0)},
		{"the next morning after one made later in the day", made(at(11, 7, 10, 15)), time.Time{}, daily, at(11, 8, 3, 0)},
		{"the next morning after one made before the time", made(at(11, 7, 1, 0)), time.Time{}, daily, at(11, 8, 3, 0)},
		{"three days on", made(at(11, 7, 3, 0)), time.Time{}, Schedule{EveryDays: 3, Hour: 3}, at(11, 10, 3, 0)},
		{"at its own time", made(at(11, 7, 3, 0)), time.Time{}, Schedule{EveryDays: 1, Hour: 22, Minute: 30}, at(11, 8, 22, 30)},
		{"a day after a look that found nothing new", made(at(11, 7, 3, 0)), at(11, 8, 3, 0), daily, at(11, 9, 3, 0)},
		{"an older look changes nothing", made(at(11, 7, 3, 0)), at(11, 6, 3, 0), daily, at(11, 8, 3, 0)},
		{"by the clock on the day the clocks go forward", made(at(3, 28, 3, 0)), time.Time{}, daily, at(3, 29, 3, 0)},
		{"by the clock on the day the clocks go back", made(at(10, 24, 3, 0)), time.Time{}, daily, at(10, 25, 3, 0)},
	}
	for _, c := range cases {
		if got := Next(c.files, c.checked, c.schedule, loc); !got.Equal(c.want) {
			t.Errorf("%s: got %v, want %v", c.name, got.In(loc), c.want)
		}
	}
}

// The hour the clocks skip has no 02:30, and that day's backup is made all
// the same rather than left for the next.
func TestATimeTheClocksSkipStillGetsItsBackupThatDay(t *testing.T) {
	loc := vienna(t)
	last := time.Date(2026, 3, 28, 2, 30, 0, 0, loc)
	got := Next([]File{{Made: last.UTC()}}, time.Time{}, Schedule{EveryDays: 1, Hour: 2, Minute: 30}, loc).In(loc)
	if got.Day() != 29 || got.Sub(last) > 24*time.Hour {
		t.Errorf("due at %v, want on the 29th", got)
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
