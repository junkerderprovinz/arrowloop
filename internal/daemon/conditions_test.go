package daemon_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// A condition holds automatic work and never holds a person.
//
// That asymmetry is the whole feature. Somebody pressing the button on battery
// has decided; a program that refused it would be arguing. And a machine
// behaving exactly as instructed must not fill the log with failures, or people
// stop reading the log, which is the one thing it exists for.

func condSandbox(t *testing.T) (*daemon.Runner, string) {
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
	body := `{"jobs":[{"name":"x","quietPeriod":"0s","left":"` +
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
	return daemon.New(cfg, hist, nil, nil), right
}

func TestAConditionHoldsAScheduledRun(t *testing.T) {
	r, right := condSandbox(t)
	r.SetCondition(func(context.Context, job.Job) error { return errors.New("on battery") })

	_, err := r.RunAutomatically(context.Background(), "x")
	if !errors.Is(err, daemon.ErrHeldBack) {
		t.Fatalf("a held run reported %v, which is not matchable as held back", err)
	}
	if _, statErr := os.Stat(filepath.Join(right, "a.txt")); statErr == nil {
		t.Error("a held run wrote anyway")
	}
	// The reason comes through, or the log says "held back" and nothing about
	// which condition, which is the one thing somebody needs to know.
	if err.Error() == daemon.ErrHeldBack.Error() {
		t.Error("the refusal carries none of the condition's own words")
	}
}

func TestAConditionNeverHoldsAHandStartedRun(t *testing.T) {
	r, right := condSandbox(t)
	r.SetCondition(func(context.Context, job.Job) error { return errors.New("on battery") })

	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("a hand-started run was held: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("a hand-started run did not write: %v", err)
	}
}

func TestNoConditionMeansNothingIsHeld(t *testing.T) {
	// The container build, and every desktop that has not switched either
	// setting on. This is the default and it must be untouched by the feature.
	r, right := condSandbox(t)
	if _, err := r.RunAutomatically(context.Background(), "x"); err != nil {
		t.Fatalf("a run with no condition was held: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("a run with no condition did not write: %v", err)
	}
}

func TestClearingTheConditionLetsRunsThroughAgain(t *testing.T) {
	r, right := condSandbox(t)
	r.SetCondition(func(context.Context, job.Job) error { return errors.New("on battery") })
	if _, err := r.RunAutomatically(context.Background(), "x"); err == nil {
		t.Fatal("the condition did not hold the first run")
	}
	r.SetCondition(nil)
	if _, err := r.RunAutomatically(context.Background(), "x"); err != nil {
		t.Fatalf("the run was still held after the condition was removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("the run did not write after the condition was removed: %v", err)
	}
}
