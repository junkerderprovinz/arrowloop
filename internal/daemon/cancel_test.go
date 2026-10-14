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
	return New(cfg, hist, func(string, ...any) {}), left, right
}

// The run log is where somebody looks to see that a run was stopped, and a
// record written with the stopped run's own context never gets there.
func TestAStoppedRunIsStillRecorded(t *testing.T) {
	r, _, _ := newRunner(t)

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
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("the run did not stop")
	}

	runs, err := r.hist.Recent(context.Background(), "test", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("the log holds %d runs for a run that was started and stopped", len(runs))
	}
	if runs[0].Err == "" {
		t.Error("the stopped run is recorded as a success")
	}
}

// A run started by hand does not end with the scheduler, so quitting has to
// stop it and wait for its record before the log closes.
func TestQuittingStopsARunAndWaitsForItsRecord(t *testing.T) {
	r, _, _ := newRunner(t)

	go func() { _, _ = r.Run(context.Background(), "test") }()
	deadline := time.Now().Add(10 * time.Second)
	for !r.Running()["test"] {
		if time.Now().After(deadline) {
			t.Fatal("the run never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r.StopAll(ctx)

	runs, err := r.hist.Recent(context.Background(), "test", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}
	if len(runs) != 1 || runs[0].Err == "" {
		t.Errorf("after quitting the log holds %+v, want the one stopped run", runs)
	}
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

// paused is the runner's configuration with the test job paused.
func paused(r *Runner) *job.Config {
	next := *r.config()
	next.Jobs = append([]job.Job(nil), next.Jobs...)
	next.Jobs[0].Disabled = true
	return &next
}

// Pause is the button somebody reaches for when a run is copying what they
// did not want copied, so it stops the run as well as the schedule.
func TestPausingAJobStopsItsRun(t *testing.T) {
	r, _, right := newRunner(t)
	// Files just written are otherwise left for later, and there would be no
	// copying to stop.
	r.config().Jobs[0].QuietPeriod = "0s"

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "test")
		done <- err
	}()
	deadline := time.Now().Add(10 * time.Second)
	for !r.Running()["test"] {
		if time.Now().After(deadline) {
			t.Fatal("the run never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	r.Reload(paused(r))

	select {
	case err := <-done:
		if err == nil {
			t.Error("the paused run reported success")
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the run went on after the job was paused")
	}
	entries, err := os.ReadDir(right)
	if err != nil {
		t.Fatalf("read the right side: %v", err)
	}
	if len(entries) >= files {
		t.Errorf("everything was copied anyway (%d files)", len(entries))
	}
}

// A paused job can still be started by hand, and saving some other setting
// while it runs is not pressing Pause.
func TestARunStartedByHandOnAPausedJobOutlivesASave(t *testing.T) {
	r, _, _ := newRunner(t)
	r.config().Jobs[0].QuietPeriod = "0s"
	r.Reload(paused(r))

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "test")
		done <- err
	}()
	deadline := time.Now().Add(10 * time.Second)
	for !r.Running()["test"] {
		if time.Now().After(deadline) {
			t.Fatal("the run never started")
		}
		time.Sleep(5 * time.Millisecond)
	}
	r.Reload(paused(r))

	// A run the save stopped would end within moments. One still going after
	// that is stopped here, so a slow machine need not copy everything.
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("the run was stopped by a save: %v", err)
		}
	case <-time.After(time.Second):
		r.Cancel("test")
		<-done
	}
}
