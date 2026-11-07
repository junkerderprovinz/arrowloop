package daemon_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/rclone/rclone/backend/ftp"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/ftptest"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// phoneJob is a job from the FTP server app on a phone, which lets four
// logins in at once, to a folder on this machine, with ten transfers as the
// settings may well ask for.
func phoneJob(t *testing.T) (*daemon.Runner, *ftptest.Server) {
	t.Helper()
	root := t.TempDir()
	phone := filepath.Join(root, "phone")
	for i := range 12 {
		dir := filepath.Join(phone, fmt.Sprintf("album%02d", i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "photo.jpg"), []byte("jpeg"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	server := ftptest.Start(t, phone, 4)

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs: []job.Job{{
			Name: "phone", Left: server.Remote(t), Right: filepath.Join(root, "pc"),
			State: filepath.Join(root, "phone.db"), QuietPeriod: "0s", Transfers: 10,
		}},
		ParallelJobs: 1,
	}
	return daemon.New(cfg, hist, t.Logf), server
}

func TestAPreviewStaysWithinTheLoginsAnFTPServerTakes(t *testing.T) {
	r, server := phoneJob(t)

	p, err := r.Preview(context.Background(), "phone")
	if err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	if len(p.Actions) != 12 {
		t.Errorf("the preview proposes %d changes, want the 12 photos", len(p.Actions))
	}
	if server.Refused() > 0 {
		t.Errorf("the server turned %d logins away", server.Refused())
	}
}

// A run right after the preview would otherwise find the preview's logins
// still open and be refused its own.
func TestAPreviewLogsOutOfTheFTPServer(t *testing.T) {
	r, server := phoneJob(t)

	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	waitFor(t, func() bool { return server.LoggedIn() == 0 }, "the preview left its logins open")
}

func TestAPreviewRightAfterAnotherGetsItsLogins(t *testing.T) {
	r, server := phoneJob(t)

	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the preview failed: %v", err)
	}
	if _, err := r.Preview(context.Background(), "phone"); err != nil {
		t.Fatalf("the second preview failed: %v", err)
	}
	if server.Refused() > 0 {
		t.Errorf("the server turned %d logins away", server.Refused())
	}
}
