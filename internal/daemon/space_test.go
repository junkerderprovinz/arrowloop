package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

func report(codes ...string) precheck.Report {
	r := precheck.Report{}
	for _, c := range codes {
		r.Findings = append(r.Findings, precheck.Finding{Code: c, Text: c + " happened", Fatal: true})
	}
	r.OK = len(codes) == 0
	return r
}

func TestARunIsRefusedWhenItWouldNotFit(t *testing.T) {
	err := refusalFrom(report("notEnoughSpace"))
	if err == nil {
		t.Fatal("a run that would not fit was allowed to start")
	}
	if !errors.Is(err, ErrNotEnoughSpace) {
		t.Errorf("the refusal is not matchable as one: %v", err)
	}
	// The log has to say which side and how much.
	if err.Error() == ErrNotEnoughSpace.Error() {
		t.Error("the refusal carries none of the report's own words")
	}
}

func TestAHealthyReportRefusesNothing(t *testing.T) {
	if err := refusalFrom(report()); err != nil {
		t.Errorf("a healthy job was refused: %v", err)
	}
}

func TestTheFirstRunOfANewJobIsNotRefused(t *testing.T) {
	// A new job has no destination folder and no state database yet.
	for _, code := range []string{"sideNew", "stateNew", "spaceUnknown", "sideNotWritten"} {
		if err := refusalFrom(report(code)); err != nil {
			t.Errorf("a report carrying only %q refused the run: %v", code, err)
		}
	}
}

func TestAnUnreachableSideIsLeftToTheRunItself(t *testing.T) {
	// The run reports these in the backend's own words.
	for _, code := range []string{"sideUnreachable", "volumeMissing", "sideMissing", "planFailed"} {
		if err := refusalFrom(report(code)); err != nil {
			t.Errorf("a report carrying only %q refused the run here: %v", code, err)
		}
	}
}

func TestSpaceStillStopsItAmongOtherFindings(t *testing.T) {
	err := refusalFrom(report("stateNew", "spaceUnknown", "notEnoughSpace", "sideNew"))
	if !errors.Is(err, ErrNotEnoughSpace) {
		t.Errorf("space did not stop the run when other findings were present: %v", err)
	}
}

// spaceSandbox is a nightly job that retries after an hour, with the space
// check replaced by answer.
func spaceSandbox(t *testing.T, answer func() precheck.Report) *Runner {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	body := `{"retry":{"attempts":3,"wait":"1h"},"jobs":[{"name":"x","schedule":"0 3 * * *","quietPeriod":"0s",` +
		`"left":"` + filepath.ToSlash(left) + `","right":"` + filepath.ToSlash(right) +
		`","state":"` + filepath.ToSlash(filepath.Join(dir, "x.db")) + `"}]}`
	path := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	hist, err := history.Open(context.Background(), cfg.History)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })

	was := checkSpace
	t.Cleanup(func() { checkSpace = was })
	checkSpace = func(context.Context, job.Job, precheck.Opts) precheck.Report { return answer() }
	return New(cfg, hist, nil)
}

// The check lists both sides in full, and a watched job's own writes ask for
// a run again and again while it is going.
func TestAJobThatIsRunningIsNotCheckedForSpaceAgain(t *testing.T) {
	var checked atomic.Int64
	r := spaceSandbox(t, func() precheck.Report {
		checked.Add(1)
		return report()
	})
	if !r.claim("x", func() {}) {
		t.Fatal("could not claim the job")
	}
	defer r.release("x")

	if _, err := r.RunAutomatically(context.Background(), "x"); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("a second run of a running job reported %v", err)
	}
	if n := checked.Load(); n != 0 {
		t.Errorf("the space was checked %d times for a job that was already running", n)
	}
}

// Without a record the retry policy never sees the refusal, and a phone wakes
// to list both sides all night.
func TestARunRefusedForSpaceIsAFailureTheRetryWaitsOn(t *testing.T) {
	r := spaceSandbox(t, func() precheck.Report { return report("notEnoughSpace") })

	if _, err := r.RunAutomatically(context.Background(), "x"); !errors.Is(err, ErrNotEnoughSpace) {
		t.Fatalf("a run that would not fit reported %v", err)
	}
	runs, err := r.hist.Recent(context.Background(), "x", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 || !runs[0].Failed() {
		t.Fatalf("the refusal left %+v in the history, want one failed run", runs)
	}
	if due := r.Due(context.Background(), time.Now()); len(due) != 0 {
		t.Errorf("the job is due again straight after it was refused: %v", due)
	}
}
