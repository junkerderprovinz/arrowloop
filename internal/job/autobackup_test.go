package job_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/autobackup"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Nobody thinks of a backup until they need one, so a file that says nothing
// gets a week of daily ones beside it, made at night.
func TestAutomaticBackupsAreOnUntilSwitchedOff(t *testing.T) {
	cfg := write(t, `{"jobs":[]}`)
	b := cfg.AutoBackup
	if !b.On() {
		t.Error("automatic backups are off in a file that says nothing")
	}
	if want := (autobackup.Schedule{EveryDays: 1, Hour: 3}); b.Schedule() != want || b.KeepCount() != 7 {
		t.Errorf("schedule %+v, keep %d; want %+v and 7", b.Schedule(), b.KeepCount(), want)
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
	cfg := write(t, `{"jobs":[],"autoBackup":{"everyDays":3,"at":"22:30","keep":30,"folder":"saved"}}`)
	b := cfg.AutoBackup
	if want := (autobackup.Schedule{EveryDays: 3, Hour: 22, Minute: 30}); b.Schedule() != want || b.KeepCount() != 30 {
		t.Errorf("schedule %+v, keep %d; want %+v and 30", b.Schedule(), b.KeepCount(), want)
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
	if got := b.Schedule().EveryDays; got != 1 || b.KeepCount() != 7 {
		t.Errorf("every %d days, keep %d; want 1 and 7", got, b.KeepCount())
	}
	huge := write(t, `{"jobs":[],"autoBackup":{"everyDays":99999,"keep":99999}}`)
	if got := huge.AutoBackup.Schedule().EveryDays; got != 365 {
		t.Errorf("every %d days; want a year at most", got)
	}
	if got := huge.AutoBackup.KeepCount(); got != 1000 {
		t.Errorf("keep %d; want 1000 at most", got)
	}
}

// A time the file cannot be read as would leave nobody knowing when the
// backups happen, so it is refused like a bad schedule.
func TestABackupTimeThatIsNoTimeOfDayIsRefused(t *testing.T) {
	for _, at := range []string{"24:00", "12:60", "7pm", "0300", "03:00:00", " 03:00", "-1:00"} {
		path := filepath.Join(t.TempDir(), "arrowloop.json")
		body := `{"jobs":[],"autoBackup":{"at":"` + at + `"}}`
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		_, err := job.Load(path)
		if err == nil || !strings.Contains(err.Error(), "autoBackup") {
			t.Errorf("%q was taken: %v", at, err)
		}
	}
	for at, want := range map[string][2]int{"00:00": {0, 0}, "23:59": {23, 59}, "7:05": {7, 5}} {
		s := write(t, `{"jobs":[],"autoBackup":{"at":"`+at+`"}}`).AutoBackup.Schedule()
		if s.Hour != want[0] || s.Minute != want[1] {
			t.Errorf("%q reads as %02d:%02d", at, s.Hour, s.Minute)
		}
	}
}

func TestSavingABadBackupTimeLeavesTheFileAlone(t *testing.T) {
	cfg := write(t, `{"jobs":[]}`)
	if _, err := cfg.SaveSettings(map[string]any{"autoBackup": map[string]any{"at": "25:00"}}); err == nil {
		t.Fatal("25:00 was saved")
	}
	again, err := job.Load(cfg.Path())
	if err != nil {
		t.Fatal(err)
	}
	if again.AutoBackup.At != "" {
		t.Errorf("the file holds at %q after the refused save", again.AutoBackup.At)
	}
}
