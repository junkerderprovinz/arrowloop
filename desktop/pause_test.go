package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// sandbox is one job copying a.txt from left to right, and the settings file
// beside its configuration.
func sandbox(t *testing.T) (*daemon.Runner, *deskset.Store, string) {
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
	return daemon.New(cfg, hist, nil, nil), deskset.Open(cfgPath), right
}

func TestAPauseHoldsAScheduledRun(t *testing.T) {
	r, store, right := sandbox(t)
	r.SetCondition(pausable(store, nil))
	if err := store.SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}

	_, err := r.RunAutomatically(context.Background(), "x")
	if !errors.Is(err, daemon.ErrHeldBack) {
		t.Fatalf("a paused run reported %v, which the log would count as a failure", err)
	}
	if _, statErr := os.Stat(filepath.Join(right, "a.txt")); statErr == nil {
		t.Error("a paused app wrote anyway")
	}
}

func TestAPauseNeverHoldsARunStartedByHand(t *testing.T) {
	r, store, right := sandbox(t)
	r.SetCondition(pausable(store, nil))
	if err := store.SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}

	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("a run started by hand was held: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("a run started by hand did not write: %v", err)
	}
}

func TestResumingLetsTheScheduleRunAgain(t *testing.T) {
	r, store, right := sandbox(t)
	r.SetCondition(pausable(store, nil))
	if err := store.SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}
	if err := store.SetPaused(false); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if _, err := r.RunAutomatically(context.Background(), "x"); err != nil {
		t.Fatalf("a resumed app still holds its runs: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Errorf("the resumed run did not write: %v", err)
	}
}

func TestWithoutAPauseTheMachineDecides(t *testing.T) {
	_, store, _ := sandbox(t)
	asked := 0
	battery := func(context.Context, job.Job) error {
		asked++
		return errors.New("on battery")
	}
	cond := pausable(store, battery)

	if err := cond(context.Background(), job.Job{Name: "x"}); err == nil || err.Error() != "on battery" {
		t.Errorf("the machine's own reason was lost: %v", err)
	}

	if err := store.SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}
	if err := cond(context.Background(), job.Job{Name: "x"}); !errors.Is(err, errPaused) {
		t.Errorf("a paused app gave %v as its reason", err)
	}
	if asked != 1 {
		t.Errorf("the battery was asked %d times; while paused its answer changes nothing", asked)
	}

	// The platforms that cannot tell about a battery have no condition at all.
	if err := store.SetPaused(false); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if err := pausable(store, nil)(context.Background(), job.Job{Name: "x"}); err != nil {
		t.Errorf("with nothing to ask, a run was held: %v", err)
	}
}
