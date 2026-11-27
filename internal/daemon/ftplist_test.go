package daemon_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/ftp"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/ftptest"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// A target set to list hidden files lists with LIST -a, which gives a time to
// the day for a photo from last year.
func TestAnFTPTargetListingHiddenFilesHasNothingToDoTheSecondRun(t *testing.T) {
	root := t.TempDir()
	server := filepath.Join(root, "server")
	if err := os.MkdirAll(server, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	taken := time.Date(2025, 11, 24, 10, 10, 37, 0, time.UTC)
	for _, name := range []string{"IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"} {
		file := filepath.Join(server, name)
		if err := os.WriteFile(file, []byte(name), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		if err := os.Chtimes(file, taken, taken); err != nil {
			t.Fatalf("chtimes: %v", err)
		}
	}
	ftp := ftptest.Start(t, server, 0)

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs: []job.Job{{
			Name: "nas", Left: strings.TrimSuffix(ftp.Remote(t), ":") + ",force_list_hidden=true:", Right: filepath.Join(root, "pc"),
			State: filepath.Join(root, "nas.db"), QuietPeriod: "0s",
		}},
		ParallelJobs: 1,
	}
	r := daemon.New(cfg, hist, t.Logf)

	first, err := r.Run(context.Background(), "nas")
	if err != nil {
		t.Fatalf("the first run failed: %v", err)
	}
	if first.Copied != 3 {
		t.Fatalf("the first run copied %d, want 3", first.Copied)
	}
	second, err := r.Run(context.Background(), "nas")
	if err != nil {
		t.Fatalf("the second run failed: %v", err)
	}
	if second.Copied != 0 || second.Skipped != 0 || second.Unchanged != 3 {
		t.Errorf("the second run copied %d, left %d for later and found %d unchanged, want all 3 unchanged",
			second.Copied, second.Skipped, second.Unchanged)
	}
}
