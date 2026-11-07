package daemon

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestTheNextBackupWaitsForItsDay(t *testing.T) {
	r, _ := configured(t, `{"jobs":[]}`)
	now := time.Now()
	r.backUpIfDue(now)
	edit(t, r, map[string]any{"bwlimit": "1M"})

	r.backUpIfDue(now.Add(time.Hour))
	if n := len(backups(t, r)); n != 1 {
		t.Errorf("%d backups an hour later; the next one is due tomorrow", n)
	}
	r.backUpIfDue(now.Add(25 * time.Hour))
	if n := len(backups(t, r)); n != 2 {
		t.Errorf("%d backups a day later, want 2", n)
	}
}

func TestBackupsFollowTheirSettings(t *testing.T) {
	r, _ := configured(t, `{"jobs":[],"autoBackup":{"everyDays":2,"keep":2,"folder":"elsewhere"}}`)
	now := time.Now()
	for day := range 8 {
		edit(t, r, map[string]any{"parallelJobs": day + 1})
		r.backUpIfDue(now.AddDate(0, 0, day))
	}
	files := backups(t, r)
	if len(files) != 2 {
		t.Fatalf("%d backups kept, want 2", len(files))
	}
	if gap := files[0].Made.Sub(files[1].Made); gap < 47*time.Hour {
		t.Errorf("two backups only %v apart, want two days", gap)
	}
	if want := filepath.Join(r.Config().Dir(), "elsewhere"); r.Backups().Folder != want {
		t.Errorf("the folder reads %s, want %s", r.Backups().Folder, want)
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
