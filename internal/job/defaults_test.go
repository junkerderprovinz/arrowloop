package job_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// write puts one configuration on disk and loads it.
func write(t *testing.T, body string) *job.Config {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return cfg
}

const sides = `"left":"/tmp/a","right":"/tmp/b","state":"a.db"`

// TestADefaultReachesAJobThatSaysNothing.
//
// The point of the whole thing. The brakes in particular could not be seen at
// all before this, let alone set once for every job, and they are the net that
// stops a run removing more than half of everything it knows about.
func TestADefaultReachesAJobThatSaysNothing(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"transfers": 8, "modWindow": "2s", "brakePercent": 30, "emptyDirs": true},
		"jobs": [{"name":"x",`+sides+`}]
	}`)

	j := cfg.Jobs[0]
	if j.Transfers != 8 {
		t.Errorf("transfers is %d, the default said 8", j.Transfers)
	}
	if j.ModWindow != "2s" {
		t.Errorf("modWindow is %q, the default said 2s", j.ModWindow)
	}
	if j.BrakePercent == nil || *j.BrakePercent != 30 {
		t.Errorf("brakePercent is %v, the default said 30", j.BrakePercent)
	}
	if j.EmptyDirs == nil || !*j.EmptyDirs {
		t.Errorf("emptyDirs is %v, the default said true", j.EmptyDirs)
	}
}

// TestAJobThatSaysSomethingKeepsIt.
//
// The other half, and the one that would quietly not work. A default is a
// fallback, never an override.
func TestAJobThatSaysSomethingKeepsIt(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"transfers": 8, "brakePercent": 30},
		"jobs": [{"name":"x","transfers":2,"brakePercent":90,`+sides+`}]
	}`)

	j := cfg.Jobs[0]
	if j.Transfers != 2 {
		t.Errorf("the default overrode the job's own transfers: %d", j.Transfers)
	}
	if j.BrakePercent == nil || *j.BrakePercent != 90 {
		t.Errorf("the default overrode the job's own brake: %v", j.BrakePercent)
	}
}

// TestOffIsAnAnswerAndNotAnAbsence.
//
// This is why the two switches became pointers. As plain bools, a job that
// deliberately turned one OFF was indistinguishable from one that never
// mentioned it, so the default turned it back on and nothing said so. That is
// the worst kind of setting: one that appears to be respected and is not.
func TestOffIsAnAnswerAndNotAnAbsence(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"emptyDirs": true, "metadata": true},
		"jobs": [{"name":"x","emptyDirs":false,"metadata":false,`+sides+`}]
	}`)

	j := cfg.Jobs[0]
	if j.EmptyDirs == nil || *j.EmptyDirs {
		t.Errorf("a job that switched emptyDirs off had it switched back on by the default: %v", j.EmptyDirs)
	}
	if j.Metadata == nil || *j.Metadata {
		t.Errorf("a job that switched metadata off had it switched back on by the default: %v", j.Metadata)
	}
}

// TestZeroIsAnAnswerForTheBrakeToo.
//
// Zero switches the mass-delete brake off entirely, which has to be something
// somebody typed rather than something they got by leaving a field out. The
// pointer already carried that distinction and the default must not break it.
func TestZeroIsAnAnswerForTheBrakeToo(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"brakePercent": 50},
		"jobs": [{"name":"x","brakePercent":0,`+sides+`}]
	}`)

	j := cfg.Jobs[0]
	if j.BrakePercent == nil || *j.BrakePercent != 0 {
		t.Errorf("a job that switched the brake off got the default instead: %v", j.BrakePercent)
	}
}

// TestADefaultIsCheckedLikeAnythingElse.
//
// Applied before validation on purpose. A default that produces an invalid job
// has to fail when the file is read, not at three in the morning on the one job
// that mattered.
func TestADefaultIsCheckedLikeAnythingElse(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	body := `{
		"defaults": {"quietPeriod": "not a duration"},
		"jobs": [{"name":"x",` + sides + `}]
	}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := job.Load(path); err == nil {
		t.Error("a default that makes every job invalid was accepted")
	}
}
