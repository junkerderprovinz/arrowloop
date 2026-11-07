package job_test

import (
	"path/filepath"
	"testing"
	"time"
)

// Nobody thinks of a backup until they need one, so a file that says nothing
// gets a week of daily ones beside it.
func TestAutomaticBackupsAreOnUntilSwitchedOff(t *testing.T) {
	cfg := write(t, `{"jobs":[]}`)
	b := cfg.AutoBackup
	if !b.On() {
		t.Error("automatic backups are off in a file that says nothing")
	}
	if b.Every() != 24*time.Hour || b.KeepCount() != 7 {
		t.Errorf("every %v, keep %d; want a day and 7", b.Every(), b.KeepCount())
	}
	if want := filepath.Join(cfg.Dir(), "backups"); cfg.BackupDir() != want {
		t.Errorf("the backups go to %s, want %s", cfg.BackupDir(), want)
	}

	off := write(t, `{"jobs":[],"autoBackup":{"off":true}}`)
	if off.AutoBackup.On() {
		t.Error("switching automatic backups off did not")
	}
}

func TestTheBackupSettingsAreRead(t *testing.T) {
	cfg := write(t, `{"jobs":[],"autoBackup":{"everyDays":3,"keep":30,"folder":"saved"}}`)
	b := cfg.AutoBackup
	if b.Every() != 72*time.Hour || b.KeepCount() != 30 {
		t.Errorf("every %v, keep %d; want three days and 30", b.Every(), b.KeepCount())
	}
	// A relative folder is relative to the file, like the history's.
	if want := filepath.Join(cfg.Dir(), "saved"); cfg.BackupDir() != want {
		t.Errorf("the backups go to %s, want %s", cfg.BackupDir(), want)
	}
}

// A typo must not switch the backups off or delete every one of them.
func TestOddBackupNumbersFallBackToSomethingSafe(t *testing.T) {
	cfg := write(t, `{"jobs":[],"autoBackup":{"everyDays":-2,"keep":-1}}`)
	b := cfg.AutoBackup
	if b.Every() != 24*time.Hour || b.KeepCount() != 7 {
		t.Errorf("every %v, keep %d; want a day and 7", b.Every(), b.KeepCount())
	}
	huge := write(t, `{"jobs":[],"autoBackup":{"everyDays":99999,"keep":99999}}`)
	if got := huge.AutoBackup.Every(); got != 365*24*time.Hour {
		t.Errorf("every %v; want a year at most", got)
	}
	if got := huge.AutoBackup.KeepCount(); got != 1000 {
		t.Errorf("keep %d; want 1000 at most", got)
	}
}
