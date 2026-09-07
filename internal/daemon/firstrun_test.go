package daemon_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// The first run is the one that decides everything and the one nobody is asked
// about. With no record, every file on both sides is new, so the engine merges
// and the other side fills up with files somebody meant to leave behind. By the
// time they notice, it has happened.

// seedSandbox puts one file on each side, so a merge and a seed produce
// visibly different results: a merge leaves two files on each side, a seed from
// the left leaves the left's file on both and the right's own where it was.
func seedSandbox(t *testing.T, firstRun string) (*daemon.Runner, string, string) {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(left, "mine.txt"), []byte("left"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(right, "theirs.txt"), []byte("right"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	setting := ""
	if firstRun != "" {
		setting = `"firstRun":"` + firstRun + `",`
	}
	body := `{"jobs":[{"name":"x",` + setting + `"quietPeriod":"0s","left":"` +
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
	return daemon.New(cfg, hist, nil, nil), left, right
}

func has(t *testing.T, dir, name string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}

func TestWithoutASeedTheFirstRunMerges(t *testing.T) {
	// The behaviour every job had before this existed, and the default.
	r, left, right := seedSandbox(t, "")
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if !has(t, right, "mine.txt") || !has(t, left, "theirs.txt") {
		t.Error("the first run did not merge")
	}
}

func TestSeedingFromTheLeftDoesNotCarryTheRightsFilesOver(t *testing.T) {
	r, left, right := seedSandbox(t, "left")
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if !has(t, right, "mine.txt") {
		t.Error("the left's file did not reach the right")
	}
	if has(t, left, "theirs.txt") {
		t.Error("the right's file was carried over anyway, so the seed did nothing")
	}
}

func TestASeedLeavesAloneWhatTheChosenSideNeverHad(t *testing.T) {
	// The difference between copying and mirroring, and it matters most here.
	// Deleting something the chosen side never knew about would not be
	// propagating a decision, it would be making one, on the run somebody
	// understands least.
	r, _, right := seedSandbox(t, "left")
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}
	if !has(t, right, "theirs.txt") {
		t.Error("seeding from the left deleted a file the right already had")
	}
}

func TestTheSeedAppliesOnceAndThenStopsMattering(t *testing.T) {
	// A setting left behind in the file must not quietly turn a two-way job
	// into a one-way one for ever.
	r, left, right := seedSandbox(t, "left")
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("first run: %v", err)
	}
	// Something new on the right, after the record exists.
	if err := os.WriteFile(filepath.Join(right, "later.txt"), []byte("later"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if !has(t, left, "later.txt") {
		t.Error("the second run still behaved one-way, so the seed never stopped applying")
	}
}
