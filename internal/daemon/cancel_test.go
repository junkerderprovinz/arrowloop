package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// files is how many the left side of a test job holds: enough that a stop lands
// halfway through the run even on a fast machine.
const files = 2000

func newRunner(t *testing.T) (*Runner, string, string) {
	t.Helper()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	for i := 0; i < files; i++ {
		name := filepath.Join(left, fmt.Sprintf("datei-%04d.txt", i))
		if err := os.WriteFile(name, make([]byte, 4096), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })

	cfg := &job.Config{
		Jobs: []job.Job{{
			Name:  "test",
			Left:  left,
			Right: right,
			State: filepath.Join(root, "state.db"),
		}},
		ParallelJobs: 1,
	}
	return New(cfg, hist, nil, func(string, ...any) {}), left, right
}

// Somebody pressing stop a second after the run finished should not be told it
// was stopped.
func TestStoppingSomethingThatIsNotRunningSaysSo(t *testing.T) {
	r, _, _ := newRunner(t)
	if r.Cancel("test") {
		t.Error("claimed to have stopped a run that was never started")
	}
	if r.Cancel("does-not-exist") {
		t.Error("claimed to have stopped a job that does not exist")
	}
}

// Driven through the real Run, because the cancel has to reach the engine and
// not only the runner.
func TestARunningJobStops(t *testing.T) {
	r, _, right := newRunner(t)

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "test")
		done <- err
	}()

	deadline := time.Now().Add(10 * time.Second)
	for !r.Cancel("test") {
		if time.Now().After(deadline) {
			t.Fatal("the run never became cancellable")
		}
		time.Sleep(5 * time.Millisecond)
	}

	select {
	case err := <-done:
		// Finished and stopped halfway leave the sides in different states.
		if err == nil {
			t.Error("a cancelled run reported success")
		} else if !errors.Is(err, context.Canceled) {
			t.Logf("stopped with: %v", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the run did not stop")
	}

	entries, err := os.ReadDir(right)
	if err != nil {
		t.Fatalf("read the right side: %v", err)
	}
	if len(entries) >= files {
		t.Errorf("everything was copied anyway (%d files), so the stop did nothing", len(entries))
	}
}
