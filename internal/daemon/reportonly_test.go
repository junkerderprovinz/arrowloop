package daemon_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// reportSandbox builds one job with a file on the left and nothing on the right,
// so any run has exactly one thing it could do.
func reportSandbox(t *testing.T, reportOnly bool) (*daemon.Runner, *history.DB, string) {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	flag := ""
	if reportOnly {
		flag = `"reportOnly":true,`
	}
	body := `{"jobs":[{"name":"x",` + flag + `"quietPeriod":"0s","left":"` +
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
	// The history handle is handed back rather than reached for through the
	// runner. Adding an accessor to the runner purely so a test could look
	// inside would be a production API that exists for the test, and the test
	// opened this database itself in the first place.
	return daemon.New(cfg, hist, nil, nil), hist, right
}

// TestAReportOnlyJobTouchesNothingOnItsSchedule.
//
// The whole promise. A person who is not yet ready to let a job write puts it
// on a schedule like any other and reads the log, and every file stays exactly
// where it was.
func TestAReportOnlyJobTouchesNothingOnItsSchedule(t *testing.T) {
	r, _, right := reportSandbox(t, true)

	if _, err := r.RunAutomatically(context.Background(), "x"); err != nil {
		t.Fatalf("report: %v", err)
	}

	got, err := os.ReadDir(right)
	if err != nil {
		t.Fatalf("read the right side: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("a report-only job wrote %d entry/entries to the other side", len(got))
	}
}

// TestAReportStillLeavesATrace.
//
// A report that records nothing answers nothing the next morning, which is the
// only reason anybody would switch this on. It has to say what it WOULD have
// done, per file.
func TestAReportStillLeavesATrace(t *testing.T) {
	r, hist, _ := reportSandbox(t, true)
	ctx := context.Background()

	if _, err := r.RunAutomatically(ctx, "x"); err != nil {
		t.Fatalf("report: %v", err)
	}

	runs, err := hist.Recent(ctx, "x", 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}
	if runs[0].Copied != 1 {
		t.Errorf("the report says it would copy %d, expected 1", runs[0].Copied)
	}

	entries, err := hist.Entries(ctx, runs[0].ID)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("the report recorded no lines at all")
	}
	for _, e := range entries {
		// Every line of a report is a proposal, and nothing that moves a file
		// ever produces one of these kinds. That is what stops a report row
		// being read as work that happened.
		if e.Kind != "skip" && !strings.HasPrefix(e.Kind, "would-") {
			t.Errorf("a report line is not marked as a proposal: %+v", e)
		}
	}
}

// TestPressingTheButtonStillWrites.
//
// The restraint is against the CLOCK, not against the person. A report-only job
// that could not be started by hand would be a disabled job with extra steps,
// and the button would appear to work while quietly doing nothing.
func TestPressingTheButtonStillWrites(t *testing.T) {
	r, _, right := reportSandbox(t, true)

	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}

	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("a hand-started run of a report-only job did not write: %v", err)
	}
}

// TestAnOrdinaryJobIsUnaffected.
//
// The flag is off by default and the automatic path must behave exactly as it
// did before it existed.
func TestAnOrdinaryJobIsUnaffected(t *testing.T) {
	r, _, right := reportSandbox(t, false)

	if _, err := r.RunAutomatically(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}

	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("an ordinary scheduled run did not write: %v", err)
	}
}
