package daemon

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// failing is a command that writes a reason and exits non-zero on either shell.
const failing = "echo the database is busy && exit 3"

func TestAFailingBeforeCommandKeepsTheRunFromStarting(t *testing.T) {
	r, _, right := newRunner(t)
	r.config().Jobs[0].Before = failing

	rec, err := r.Run(context.Background(), "test")
	if err == nil {
		t.Fatal("the run went ahead after its before command failed")
	}
	if !strings.Contains(rec.Err, "the database is busy") {
		t.Errorf("the run record says %q, without the command's own words", rec.Err)
	}
	copied, _ := os.ReadDir(right)
	if len(copied) != 0 {
		t.Errorf("%d files were copied although the run should not have started", len(copied))
	}
}

func TestTheAfterCommandLearnsTheOutcome(t *testing.T) {
	r, _, _ := newRunner(t)
	out := filepath.Join(t.TempDir(), "outcome")
	cmd := `echo $ARROWLOOP_RESULT $ARROWLOOP_SKIPPED > "` + out + `"`
	if runtime.GOOS == "windows" {
		cmd = `> "` + out + `" echo %ARROWLOOP_RESULT% %ARROWLOOP_SKIPPED%`
	}
	r.config().Jobs[0].After = cmd

	rec, err := r.Run(context.Background(), "test")
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("the after command did not run: %v", err)
	}
	want := "ok " + strconv.Itoa(rec.Skipped)
	if rec.Skipped == 0 || strings.TrimSpace(string(got)) != want {
		t.Errorf("the after command saw %q, want %q", got, want)
	}
}

func TestAFailingAfterCommandMarksTheRun(t *testing.T) {
	r, _, _ := newRunner(t)
	r.config().Jobs[0].After = failing

	rec, err := r.Run(context.Background(), "test")
	if err == nil || !strings.Contains(rec.Err, "after the run") {
		t.Errorf("a failed after command left the run looking clean: %q", rec.Err)
	}
}
