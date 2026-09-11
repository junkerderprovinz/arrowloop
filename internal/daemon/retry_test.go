package daemon_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// What a failed schedule does next.
//
// The schedule works out what is OWED from the last SUCCESS, so a job that
// failed is still owed a run and gets one at the next turn of the clock. On a
// phone that clock turns every fifteen minutes, so before this the answer to
// "the remote is down" was: wake up and try again, all night, for ever.
//
// Every test here is about the second half of the sentence, not the first. The
// retry itself must survive - a hiccup at three in the morning must not cost a
// whole night - and it must stop.

// retrySandbox is a job with a nightly schedule and a history we can write
// failures into by hand, which is what makes the timing testable at all: a real
// failure needs a real broken remote, and the thing under test is the clock.
func retrySandbox(t *testing.T, attempts int, wait string) (*daemon.Runner, *history.DB) {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	body := `{"retry":{"attempts":` + itoa(attempts) + `,"wait":"` + wait + `"},` +
		`"jobs":[{"name":"x","schedule":"0 3 * * *","quietPeriod":"0s","left":"` +
		filepath.ToSlash(left) + `","right":"` + filepath.ToSlash(right) + `","state":"` +
		filepath.ToSlash(filepath.Join(dir, "x.db")) + `"}]}`
	cfgPath := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(cfgPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := job.Load(cfgPath)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	hist, err := history.Open(context.Background(), cfg.History)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	return daemon.New(cfg, hist, nil, nil), hist
}

// record writes one run into the log: an error means it failed.
func record(t *testing.T, hist *history.DB, at time.Time, err string) {
	t.Helper()
	if writeErr := hist.Record(context.Background(), history.Run{
		Job:      "x",
		Started:  at,
		Finished: at,
		Err:      err,
	}, nil); writeErr != nil {
		t.Fatalf("record: %v", writeErr)
	}
}

func isDue(t *testing.T, r *daemon.Runner, now time.Time) bool {
	t.Helper()
	for _, name := range r.Due(context.Background(), now) {
		if name == "x" {
			return true
		}
	}
	return false
}

func TestAFailedRunIsTriedAgainAfterTheWait(t *testing.T) {
	r, hist := retrySandbox(t, 3, "5m")
	failed := time.Date(2026, 9, 12, 3, 0, 0, 0, time.Local)
	record(t, hist, failed, "the remote refused the connection")

	if isDue(t, r, failed.Add(time.Minute)) {
		t.Error("it tried again one minute after failing, which is the phone waking every fifteen minutes all over again")
	}
	if !isDue(t, r, failed.Add(6*time.Minute)) {
		t.Error("it never tried again, so one hiccup at three in the morning costs the whole night")
	}
}

func TestTheWaitDoublesWithEachFailure(t *testing.T) {
	r, hist := retrySandbox(t, 3, "5m")
	first := time.Date(2026, 9, 12, 3, 0, 0, 0, time.Local)
	record(t, hist, first, "down")
	record(t, hist, first.Add(6*time.Minute), "still down")

	// Two failures, so the next wait is ten minutes rather than five.
	after := first.Add(6 * time.Minute)
	if isDue(t, r, after.Add(6*time.Minute)) {
		t.Error("the second wait was no longer than the first, so a remote that is down for an hour is asked twelve times")
	}
	if !isDue(t, r, after.Add(11*time.Minute)) {
		t.Error("the second wait never ended")
	}
}

func TestItStopsTryingAndWaitsForTheClock(t *testing.T) {
	r, hist := retrySandbox(t, 2, "5m")
	at := time.Date(2026, 9, 12, 3, 0, 0, 0, time.Local)
	for i := 0; i < 3; i++ {
		record(t, hist, at.Add(time.Duration(i)*10*time.Minute), "down")
		at = at.Add(time.Duration(i) * 10 * time.Minute)
	}
	last := time.Date(2026, 9, 12, 3, 30, 0, 0, time.Local)

	if isDue(t, r, last.Add(2*time.Hour)) {
		t.Error("it kept trying past its last attempt, which is the all-night wake-up this setting exists to stop")
	}
	// Three in the morning the next day. The job is owed a run again, and the
	// point of stopping was to wait for exactly this, not to give up.
	if !isDue(t, r, time.Date(2026, 9, 13, 3, 1, 0, 0, time.Local)) {
		t.Error("it never came back, so one bad night switched the schedule off for good")
	}
}

func TestNoAttemptsMeansWaitForTheClock(t *testing.T) {
	r, hist := retrySandbox(t, 0, "5m")
	failed := time.Date(2026, 9, 12, 3, 0, 0, 0, time.Local)
	record(t, hist, failed, "down")

	if isDue(t, r, failed.Add(4*time.Hour)) {
		t.Error("it tried again although nobody asked for any further tries")
	}
	if !isDue(t, r, time.Date(2026, 9, 13, 3, 1, 0, 0, time.Local)) {
		t.Error("the next night never came")
	}
}

func TestASuccessClearsTheFailures(t *testing.T) {
	r, hist := retrySandbox(t, 1, "5m")
	at := time.Date(2026, 9, 12, 3, 0, 0, 0, time.Local)
	record(t, hist, at, "down")
	record(t, hist, at.Add(10*time.Minute), "down")
	// Out of attempts, and then it works. The next night must be a clean slate
	// rather than a job still counting yesterday's failures.
	record(t, hist, at.Add(20*time.Minute), "")

	next := time.Date(2026, 9, 13, 3, 1, 0, 0, time.Local)
	if !isDue(t, r, next) {
		t.Error("yesterday's failures were still being counted after a success")
	}
}
