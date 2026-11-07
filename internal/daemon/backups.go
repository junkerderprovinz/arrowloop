package daemon

import (
	"path/filepath"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/autobackup"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// backupRetry is how long the schedule waits after a failed backup. Trying on
// every tick would log the same full disk once a minute.
const backupRetry = time.Hour

// BackupRun is how the last automatic backup went.
type BackupRun struct {
	At time.Time `json:"at"`
	// File is the backup written, empty when none was.
	File string `json:"file,omitempty"`
	// Unchanged says the file matched the newest backup, so none was needed.
	Unchanged bool   `json:"unchanged,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Backups is what the settings show about the automatic backups.
type Backups struct {
	On     bool   `json:"on"`
	Folder string `json:"folder"`
	// Files is newest first and never nil.
	Files []autobackup.File `json:"files"`
	// Last is nil until this process has made or tried one.
	Last *BackupRun `json:"last"`
}

// backupState is the schedule's memory in this process. Losing it in a
// restart costs one extra look at the newest file.
type backupState struct {
	mu sync.Mutex
	// checked is when a look last found nothing new to back up.
	checked time.Time
	retryAt time.Time
	last    *BackupRun
}

// backUpIfDue makes an automatic backup when the schedule says one is due.
func (r *Runner) backUpIfDue(now time.Time) {
	cfg := r.config()
	if !cfg.AutoBackup.On() || cfg.Path() == "" {
		return
	}
	b := &r.backups
	b.mu.Lock()
	defer b.mu.Unlock()
	if now.Before(b.retryAt) {
		return
	}
	files, err := autobackup.List(cfg.BackupDir())
	// now is on the machine's clock, which the jobs' cron schedules follow
	// too.
	if err == nil && now.Before(autobackup.Next(files, b.checked, cfg.AutoBackup.Schedule(), now.Location())) {
		return
	}
	r.backUp(cfg, now)
}

// BackUp makes an automatic backup now, whatever the schedule says, unless
// they are switched off. An import calls it before it replaces everything.
func (r *Runner) BackUp(now time.Time) error {
	cfg := r.config()
	if !cfg.AutoBackup.On() || cfg.Path() == "" {
		return nil
	}
	r.backups.mu.Lock()
	defer r.backups.mu.Unlock()
	return r.backUp(cfg, now)
}

// backUp writes the backup and records how it went. The caller holds the
// state's lock. The error is only for a backup that was not written.
func (r *Runner) backUp(cfg *job.Config, now time.Time) error {
	b := &r.backups
	dir := cfg.BackupDir()
	run := BackupRun{At: now}
	f, wrote, err := autobackup.Save(dir, cfg.Raw(), now, cfg.AutoBackup.KeepCount())
	b.last = &run
	if err != nil && !wrote {
		run.Error = err.Error()
		b.retryAt = now.Add(backupRetry)
		r.log("the automatic backup failed and is tried again in an hour: %v", err)
		return err
	}
	b.retryAt = time.Time{}
	switch {
	case err != nil:
		// The new backup is there, so the run counts.
		run.File = f.Name
		r.log("wrote the automatic backup %s, but the older ones stay: %v", f.Name, err)
	case !wrote:
		run.Unchanged = true
		b.checked = now
	default:
		run.File = f.Name
		r.log("wrote the automatic backup %s", filepath.Join(dir, f.Name))
	}
	return nil
}

// Backups lists the automatic backups and how the last one went.
func (r *Runner) Backups() Backups {
	cfg := r.config()
	out := Backups{On: cfg.AutoBackup.On(), Folder: cfg.BackupDir()}
	// A folder that cannot be read is the failure the run itself records.
	out.Files, _ = autobackup.List(out.Folder)
	if out.Files == nil {
		out.Files = []autobackup.File{}
	}
	r.backups.mu.Lock()
	defer r.backups.mu.Unlock()
	if r.backups.last != nil {
		last := *r.backups.last
		out.Last = &last
	}
	return out
}
