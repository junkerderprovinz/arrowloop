package daemon

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/notify"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// stopMidway starts the test job, stops it with stop once it has copied a few
// files and returns the run as it was recorded.
func stopMidway(t *testing.T, r *Runner, stop func()) history.Run {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "test")
		done <- err
	}()
	deadline := time.Now().Add(30 * time.Second)
	for {
		if w := r.Working(); len(w) == 1 && w[0].Done >= 20 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the run never got going")
		}
		time.Sleep(time.Millisecond)
	}
	stop()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("the run did not stop")
	}
	runs := runsOf(t, r, "test")
	if len(runs) != 1 {
		t.Fatalf("the log holds %d runs for one that was stopped", len(runs))
	}
	return runs[0]
}

func copying(t *testing.T) (*Runner, string) {
	t.Helper()
	r, _, right := newRunner(t)
	// Files just written are otherwise left for later, and there would be no
	// copying to stop.
	r.config().Jobs[0].QuietPeriod = "0s"
	return r, right
}

func TestAStoppedRunIsRecordedAsStoppedAndNotAsFailed(t *testing.T) {
	for name, stop := range map[string]func(r *Runner){
		"cancelled": func(r *Runner) { r.Cancel("test") },
		"paused":    func(r *Runner) { r.Reload(paused(r)) },
	} {
		t.Run(name, func(t *testing.T) {
			r, _ := copying(t)
			run := stopMidway(t, r, func() { stop(r) })
			if !run.Stopped || run.Failed() {
				t.Errorf("the run is recorded as %+v, want stopped and not failed", run)
			}
		})
	}
}

// Whoever stopped the run knows, so nobody is told it failed, and the run
// says nothing about how the job usually does.
func TestAStoppedRunSendsNoFailureAndLeavesTheNotesAlone(t *testing.T) {
	r, _ := copying(t)
	hook, hc := newInbox(t), newInbox(t)
	notifying(r, slack("hook", hook.url("/hook"), notify.OnFailure), checks(hc.url("/check"), nil))
	one := 1
	r.config().Anomalies.FailingAfter = &one
	r.anomalies.Raise(anomaly.Finding{Job: "test", Kind: anomaly.Failing, Count: 3, Detail: "the last 3 runs failed"})

	stopMidway(t, r, func() { r.Cancel("test") })

	if got := hook.all(); len(got) != 0 {
		t.Errorf("a stopped run was reported: %v", got)
	}
	pings := hc.all()
	if len(pings) != 2 || pings[0] != "/check/start " || !strings.HasPrefix(pings[1], "/check/log ") {
		t.Errorf("the check heard %q, want the start and a log line", pings)
	}
	if !r.anomalies.Has("test", anomaly.Failing) {
		t.Error("a stopped run closed the note about failing runs")
	}
}

// Pausing in the middle of a big copy costs only the file in flight: the
// next run skips what the stopped one finished.
func TestTheRunAfterAStopPicksUpWhereItStopped(t *testing.T) {
	r, right := copying(t)
	stopMidway(t, r, func() { r.Reload(paused(r)) })
	there, err := os.ReadDir(right)
	if err != nil {
		t.Fatalf("read the right side: %v", err)
	}
	if len(there) == 0 || len(there) >= files {
		t.Fatalf("the stopped run left %d of %d files", len(there), files)
	}

	next, err := r.Run(context.Background(), "test")
	if err != nil {
		t.Fatalf("the run after the stop: %v", err)
	}
	if next.Copied > files-len(there)+1 {
		t.Errorf("the run after the stop copied %d files, though only %d were left", next.Copied, files-len(there))
	}
	if all, _ := os.ReadDir(right); len(all) != files {
		t.Errorf("after both runs the right side holds %d of %d files", len(all), files)
	}
}

// A script after the run tells a stopped run from a good one and from a
// failed one.
func TestTheAfterCommandHearsTheRunWasStopped(t *testing.T) {
	r, _ := copying(t)
	out := filepath.Join(t.TempDir(), "outcome")
	cmd := `echo $ARROWLOOP_RESULT > "` + out + `"`
	if runtime.GOOS == "windows" {
		cmd = `> "` + out + `" echo %ARROWLOOP_RESULT%`
	}
	r.config().Jobs[0].After = cmd

	stopMidway(t, r, func() { r.Cancel("test") })
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("the after command did not run: %v", err)
	}
	if strings.TrimSpace(string(got)) != "stopped" {
		t.Errorf("the after command saw %q, want stopped", got)
	}
}
