package daemon

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"
	_ "time/tzdata"

	"github.com/junkerderprovinz/arrowloop/internal/autobackup"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// configured is a runner over a configuration file holding body, without a
// run log.
func configured(t *testing.T, body string) (*Runner, *heard) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "arrowloop.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	h := &heard{}
	return New(cfg, nil, h.log), h
}

// edit changes the configuration the way a save in the interface does.
func edit(t *testing.T, r *Runner, settings map[string]any) {
	t.Helper()
	next, err := r.Config().SaveSettings(settings)
	if err != nil {
		t.Fatal(err)
	}
	r.Reload(next)
}

func backups(t *testing.T, r *Runner) []autobackup.File {
	t.Helper()
	files, err := autobackup.List(r.Config().BackupDir())
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func TestTheFirstLookMakesABackupOfTheFile(t *testing.T) {
	r, _ := configured(t, `{"jobs":[],"bwlimit":"2M"}`)
	now := time.Now()
	r.backUpIfDue(now)

	files := backups(t, r)
	if len(files) != 1 {
		t.Fatalf("%d backups after the first look", len(files))
	}
	got, err := autobackup.Read(r.Config().BackupDir(), files[0].Name)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, r.Config().Raw()) {
		t.Errorf("the backup holds %s, not the file", got)
	}
	state := r.Backups()
	if state.Last == nil || state.Last.File != files[0].Name || state.Last.Error != "" {
		t.Errorf("the last run reads %+v", state.Last)
	}
}

// in is a moment in Vienna, whose clocks change for summer.
func in(t *testing.T, month time.Month, day, hour, minute int) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Vienna")
	if err != nil {
		t.Fatal(err)
	}
	return time.Date(2026, month, day, hour, minute, 0, 0, loc)
}

var edits atomic.Int64

// changedAt edits the file and then looks whether a backup is due at now,
// and reports whether that look wrote one.
func changedAt(t *testing.T, r *Runner, now time.Time) bool {
	t.Helper()
	newest := func() string {
		if files := backups(t, r); len(files) > 0 {
			return files[0].Name
		}
		return ""
	}
	before := newest()
	edit(t, r, map[string]any{"bwlimit": fmt.Sprintf("%dk", edits.Add(1))})
	r.backUpIfDue(now)
	return newest() != before
}

func TestTheNextBackupWaitsForItsTimeOfDay(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	r.backUpIfDue(in(t, 11, 7, 10, 0))
	if n := len(backups(t, r)); n != 1 {
		t.Fatalf("%d backups after the first look; the first one is due at once", n)
	}
	if changedAt(t, r, in(t, 11, 7, 23, 0)) {
		t.Error("a second backup the same day")
	}
	if changedAt(t, r, in(t, 11, 8, 2, 59)) {
		t.Error("a backup the next day before 03:00")
	}
	if !changedAt(t, r, in(t, 11, 8, 3, 0)) {
		t.Error("no backup the next day at 03:00")
	}
}

func TestBackupsFollowTheirSettings(t *testing.T) {
	r, _ := configured(t, `{"jobs":[],"autoBackup":{"everyDays":3,"at":"22:30","keep":2,"folder":"elsewhere"}}`)
	r.backUpIfDue(in(t, 11, 1, 22, 30))
	var made []int
	for day := 2; day <= 10; day++ {
		if changedAt(t, r, in(t, 11, day, 22, 29)) {
			t.Errorf("a backup on the %dth before 22:30", day)
		}
		if changedAt(t, r, in(t, 11, day, 22, 30)) {
			made = append(made, day)
		}
	}
	if !slices.Equal(made, []int{4, 7, 10}) {
		t.Errorf("backups on the %v, want the 4th, 7th and 10th", made)
	}
	if n := len(backups(t, r)); n != 2 {
		t.Errorf("%d backups kept, want 2", n)
	}
	if want := filepath.Join(r.Config().Dir(), "elsewhere"); r.Backups().Folder != want {
		t.Errorf("the folder reads %s, want %s", r.Backups().Folder, want)
	}
}

// An engine that was off or asleep at the time makes the backup when it is
// back, once, and the one after it at the time again.
func TestAMissedBackupIsCaughtUpOnce(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	r.backUpIfDue(in(t, 11, 7, 3, 0))

	if !changedAt(t, r, in(t, 11, 12, 9, 40)) {
		t.Fatal("no backup when the engine was back after five days")
	}
	for _, later := range []time.Time{in(t, 11, 12, 9, 41), in(t, 11, 12, 13, 0), in(t, 11, 13, 2, 59)} {
		if changedAt(t, r, later) {
			t.Errorf("caught up again at %v", later)
		}
	}
	if !changedAt(t, r, in(t, 11, 13, 3, 0)) {
		t.Error("no backup at 03:00 the day after the catch-up")
	}
}

// The night the clocks go forward is an hour short, and the backup keeps to
// the clock rather than to 24 hours.
func TestTheBackupKeepsItsTimeWhenTheClocksChange(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	r.backUpIfDue(in(t, 3, 28, 3, 0))
	if !changedAt(t, r, in(t, 3, 29, 3, 0)) {
		t.Error("no backup at 03:00 on the day the clocks go forward")
	}
	if !changedAt(t, r, in(t, 10, 24, 3, 0)) {
		t.Fatal("no backup in October")
	}
	if !changedAt(t, r, in(t, 10, 25, 3, 0)) {
		t.Error("no backup at 03:00 on the day the clocks go back")
	}
	if changedAt(t, r, in(t, 10, 25, 4, 0)) {
		t.Error("a second backup on the day the clocks go back")
	}
}

// A look that finds the file as the newest backup has it writes nothing and
// counts as that day's backup.
func TestAnUnchangedFileWaitsForTheNextTime(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	r.backUpIfDue(in(t, 11, 7, 3, 0))
	r.backUpIfDue(in(t, 11, 8, 3, 0))
	if n := len(backups(t, r)); n != 1 {
		t.Fatalf("%d backups of a file that did not change", n)
	}
	if last := r.Backups().Last; last == nil || !last.Unchanged {
		t.Errorf("the last run reads %+v, want unchanged", last)
	}
	if changedAt(t, r, in(t, 11, 8, 18, 0)) {
		t.Error("a backup the same day as the look that found nothing new")
	}
	if !changedAt(t, r, in(t, 11, 9, 3, 0)) {
		t.Error("no backup the morning after")
	}
}

func TestNoBackupIsMadeWhileTheyAreOff(t *testing.T) {
	r, _ := configured(t, `{"jobs":[],"autoBackup":{"off":true}}`)
	r.backUpIfDue(time.Now())
	if err := r.BackUp(time.Now()); err != nil {
		t.Fatal(err)
	}
	if n := len(backups(t, r)); n != 0 {
		t.Errorf("%d backups while they are off", n)
	}
	if r.Backups().On {
		t.Error("the state says they are on")
	}
}

// An import replaces everything, so the setup it replaces is kept first, even
// when the day's backup was already made.
func TestBackUpDoesNotWaitForTheSchedule(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	now := time.Now()
	r.backUpIfDue(now)
	edit(t, r, map[string]any{"bwlimit": "1M"})

	if err := r.BackUp(now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	files := backups(t, r)
	if len(files) != 2 {
		t.Fatalf("%d backups, want the one before the import as well", len(files))
	}
	got, _ := autobackup.Read(r.Config().BackupDir(), files[0].Name)
	if !bytes.Equal(got, r.Config().Raw()) {
		t.Errorf("the newest backup is not the setup the import replaces: %s", got)
	}
}

// A phone's engine has no clock ticking between wake-ups.
func TestAWakeUpMakesTheBackup(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	r.RunDue(context.Background())
	if n := len(backups(t, r)); n != 1 {
		t.Errorf("%d backups after a wake-up", n)
	}
}

func TestAFailedBackupIsToldAndTriedAgainLater(t *testing.T) {
	r, h := configured(t, `{"jobs":[]}`)
	blocker := filepath.Join(r.Config().Dir(), "not-a-folder")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	edit(t, r, map[string]any{"autoBackup": map[string]any{"folder": filepath.Join(blocker, "backups")}})

	now := time.Now()
	r.backUpIfDue(now)
	last := r.Backups().Last
	if last == nil || last.Error == "" {
		t.Fatalf("the failure is not in the state: %+v", last)
	}
	if !h.said("automatic backup") {
		t.Errorf("the failure was not logged: %v", h.lines)
	}

	// Mended, but the retry waits its hour rather than hammering the disk.
	edit(t, r, map[string]any{"autoBackup": map[string]any{"folder": "backups"}})
	r.backUpIfDue(now.Add(time.Minute))
	if n := len(backups(t, r)); n != 0 {
		t.Errorf("tried again after a minute: %d backups", n)
	}
	r.backUpIfDue(now.Add(61 * time.Minute))
	if n := len(backups(t, r)); n != 1 {
		t.Errorf("%d backups an hour later, want 1", n)
	}
}
