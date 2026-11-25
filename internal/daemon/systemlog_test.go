package daemon_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/rclone/rclone/backend/ftp"
	"github.com/rclone/rclone/fs/config/obscure"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/systemlog"
)

func TestARunThatCannotReachItsServerIsNotedInTheSystemLog(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	hist, err := history.Open(ctx, filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	pass := obscure.MustObscure("hunter2")
	cfg := &job.Config{
		Jobs: []job.Job{{
			// .invalid never resolves, and Go says so in its own words on
			// every system.
			Name: "nas", Left: filepath.Join(root, "pc"),
			Right: ":ftp,host=nas.invalid,user=bob,pass=" + pass + ":/photos",
			State: filepath.Join(root, "nas.db"),
		}},
		ParallelJobs: 1,
	}
	r := daemon.New(cfg, hist, t.Logf)
	log := systemlog.New(hist)
	r.SetSystemLog(log)

	if _, err := r.Run(ctx, "nas"); err == nil {
		t.Fatal("the run reached a server that is not there")
	}
	log.Close()

	lines, err := hist.SystemLog(ctx, 10)
	if err != nil {
		t.Fatalf("read the system log: %v", err)
	}
	if len(lines) != 1 || lines[0].Source != systemlog.Connection || !strings.HasPrefix(lines[0].Text, "nas: ") {
		t.Fatalf("the system log holds %+v, want the job's connection error", lines)
	}
	if strings.Contains(lines[0].Text, pass) {
		t.Errorf("the system log kept the password: %q", lines[0].Text)
	}
}

func TestARunThatFailsOverItsFilesIsLeftToTheHistory(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	hist, err := history.Open(ctx, filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs: []job.Job{{
			Name: "photos", Left: filepath.Join(root, "missing"), Right: filepath.Join(root, "pc"),
			State: filepath.Join(root, "photos.db"),
		}},
		ParallelJobs: 1,
	}
	r := daemon.New(cfg, hist, t.Logf)
	log := systemlog.New(hist)
	r.SetSystemLog(log)

	rec, _ := r.Run(ctx, "photos")
	log.Close()

	if lines, _ := hist.SystemLog(ctx, 10); len(lines) != 0 {
		t.Errorf("a run that failed with %q put %+v into the system log", rec.Err, lines)
	}
}
