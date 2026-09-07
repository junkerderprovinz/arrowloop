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

// Versioning is a setting on a job, applied by a package three layers down,
// carried there through a context. Every one of those hops is somewhere it can
// quietly not arrive, and the symptom would be the worst kind: the setting is
// on, nothing errors, and the versions somebody is relying on are simply not
// being kept. Nobody finds out until they go looking for one.
//
// So this is an end-to-end test on purpose, from the configuration file to the
// bytes on disk, rather than a check that one function passes a number to
// another.

func versionSandbox(t *testing.T, keep int) (*daemon.Runner, string, string) {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}

	setting := ""
	if keep > 0 {
		setting = `"keepVersions":` + itoa(keep) + `,`
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

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var d []byte
	for n > 0 {
		d = append([]byte{byte('0' + n%10)}, d...)
		n /= 10
	}
	return string(d)
}

// overwrite edits the left file and syncs, so the right side's copy is replaced.
func overwrite(t *testing.T, r *daemon.Runner, left, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := r.Run(context.Background(), "x"); err != nil {
		t.Fatalf("run: %v", err)
	}
}

func versionsIn(t *testing.T, side string) []string {
	t.Helper()
	dir := filepath.Join(side, ".arrowloop", "versions", "a.txt")
	found, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range found {
		names = append(names, e.Name())
	}
	return names
}

func TestVersioningIsOffUntilAJobAsksForIt(t *testing.T) {
	// The default, and every job today. Nothing extra on disk.
	r, left, right := versionSandbox(t, 0)
	overwrite(t, r, left, "one")
	overwrite(t, r, left, "two")

	if got := versionsIn(t, right); len(got) != 0 {
		t.Errorf("a job that never asked for versions kept %v", got)
	}
}

func TestTheSettingReachesAllTheWayToTheDisk(t *testing.T) {
	r, left, right := versionSandbox(t, 3)
	overwrite(t, r, left, "one")
	overwrite(t, r, left, "two")

	got := versionsIn(t, right)
	if len(got) == 0 {
		t.Fatal("the job asked to keep versions and none were kept: the setting did not survive the trip")
	}
}

func TestOnlyTheLastFewAreKept(t *testing.T) {
	// The other half of the promise. A history that grows without bound is not
	// a feature, it is the tree doubling in size while nobody watches.
	r, left, right := versionSandbox(t, 2)
	for _, body := range []string{"one", "two", "three", "four", "five"} {
		overwrite(t, r, left, body)
	}

	got := versionsIn(t, right)
	if len(got) > 2 {
		t.Errorf("asked to keep 2 and kept %d: %v", len(got), got)
	}
	if len(got) == 0 {
		t.Error("asked to keep 2 and kept none")
	}
}
