package web_test

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// The interface no longer lists a job that was removed, but its run can be
// winding down for a while, and the stop button it was showing still has to
// reach it.
func TestARemovedJobsRunCanStillBeStopped(t *testing.T) {
	h := newHarness(t)

	pause := func(seconds int) string {
		if runtime.GOOS == "windows" {
			return fmt.Sprintf("ping -n %d 127.0.0.1 > nul", seconds+1)
		}
		return fmt.Sprintf("sleep %d", seconds)
	}
	body := fmt.Sprintf(`{"jobs":[{"name":"photos","left":%q,"right":%q,"state":%q,"before":%q,"after":%q}]}`,
		filepath.ToSlash(h.left), filepath.ToSlash(h.right), filepath.ToSlash(filepath.Join(h.dir, "photos.db")),
		pause(5), pause(3))
	if err := os.WriteFile(h.configPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := job.Load(h.configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	h.runner.Reload(cfg)

	h.post(t, "/api/jobs/photos/run", "").Body.Close()
	deadline := time.Now().Add(5 * time.Second)
	for !h.runner.Running()["photos"] {
		if time.Now().After(deadline) {
			t.Fatal("the run never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Cleanup(func() {
		deadline := time.Now().Add(15 * time.Second)
		for h.runner.Running()["photos"] && time.Now().Before(deadline) {
			time.Sleep(20 * time.Millisecond)
		}
	})

	if resp, text := h.put(t, "/api/config", `{"jobs":[]}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("removing the job was refused: %s %s", resp.Status, text)
	}

	resp, text := doJSON(t, h.srv, http.MethodPost, "/api/jobs/photos/stop", "")
	if resp.StatusCode != http.StatusOK || !strings.Contains(text, `"stopped":true`) {
		t.Errorf("stopping the removed job's run answered %s %s", resp.Status, text)
	}
}
