package daemon

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// runnerWithALink is a job whose left side holds a symlink, which every run
// leaves for later.
func runnerWithALink(t *testing.T) *Runner {
	t.Helper()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.Symlink(filepath.Join(left, "a.txt"), filepath.Join(left, "link.txt")); err != nil {
		t.Skipf("this system does not let the test create a symlink: %v", err)
	}
	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs:         []job.Job{{Name: "test", Left: left, Right: right, State: filepath.Join(root, "state.db"), QuietPeriod: "0s"}},
		ParallelJobs: 1,
	}
	return New(cfg, hist, func(string, ...any) {})
}

func TestAFileLeftForLaterOnceDoesNotFailTheRun(t *testing.T) {
	rec, err := runnerWithALink(t).Run(context.Background(), "test")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if rec.Skipped != 1 || rec.Failed() {
		t.Fatalf("run %+v, want one file left for later and no failure", rec)
	}
}

func TestAFileLeftForLaterTwiceInARowFailsTheSecondRun(t *testing.T) {
	r := runnerWithALink(t)
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("first run: %v", err)
	}
	rec, err := r.Run(context.Background(), "test")
	if err == nil || !rec.Failed() {
		t.Fatalf("run %+v with error %v, want it failed", rec, err)
	}
	if f := failure.Of(rec.Err); f == nil || f.Code != failure.LeftTwice {
		t.Fatalf("failure %+v from %q, want %s", f, rec.Err, failure.LeftTwice)
	}
}
