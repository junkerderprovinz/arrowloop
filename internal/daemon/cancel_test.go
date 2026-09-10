package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// A run has to be stoppable, and stopping it must not look like finishing it.
//
// There was no way to stop one at all: a job started against a share that
// turned out to be half mounted could only be watched to the end. On a phone,
// where this engine is going next, a sync that cannot be stopped is a sync that
// drains a battery on a train.
//
// The two tests below are the two halves of the promise. One is that pressing
// stop reaches the run; the other is that pressing it when nothing is running
// says so rather than pretending.

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
	// Enough files that the run lasts long enough to be interrupted, and small
	// enough that the test is quick when it is not.
	for i := 0; i < 400; i++ {
		name := filepath.Join(left, "datei-"+string(rune('a'+i%26))+"-"+time.Now().Format("")+string(rune('0'+i/26%10))+".txt")
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
	}
	return New(cfg, hist, nil, func(string, ...any) {}), left, right
}

// TestStoppingSomethingThatIsNotRunningSaysSo.
//
// The honest answer to "stop" when nothing is going is "there was nothing to
// stop", and the interface needs it: somebody who presses the button a second
// after the run finished should not be told it was stopped.
func TestStoppingSomethingThatIsNotRunningSaysSo(t *testing.T) {
	r, _, _ := newRunner(t)
	if r.Cancel("test") {
		t.Error("claimed to have stopped a run that was never started")
	}
	if r.Cancel("does-not-exist") {
		t.Error("claimed to have stopped a job that does not exist")
	}
}

// TestARunningJobStops.
//
// Driven through the real Run rather than through a stub, because what is being
// tested is that the cancel reaches the ENGINE - a flag flipped on the runner
// while the transfer carries on regardless would pass any test that only looks
// at the runner.
func TestARunningJobStops(t *testing.T) {
	r, _, right := newRunner(t)

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "test")
		done <- err
	}()

	// Wait until it is genuinely under way, rather than sleeping a fixed time:
	// a fixed sleep either flakes on a slow machine or wastes a second on a
	// fast one.
	deadline := time.Now().Add(10 * time.Second)
	for !r.Cancel("test") {
		if time.Now().After(deadline) {
			t.Fatal("the run never became cancellable")
		}
		time.Sleep(5 * time.Millisecond)
	}

	select {
	case err := <-done:
		// A cancelled run reports the cancellation. It must NOT report success:
		// "finished" and "stopped halfway" leave the two sides in different
		// states and a person needs to know which one happened.
		if err == nil {
			t.Error("a cancelled run reported success")
		} else if !errors.Is(err, context.Canceled) {
			t.Logf("stopped with: %v", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the run did not stop")
	}

	// And it stopped EARLY: the whole point is that the work did not all happen.
	entries, err := os.ReadDir(right)
	if err != nil {
		t.Fatalf("read the right side: %v", err)
	}
	if len(entries) >= 400 {
		t.Errorf("everything was copied anyway (%d files), so the stop did nothing", len(entries))
	}
}
