package job_test

import (
	"os"
	"path/filepath"
	"strings"
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

// A default is a fallback, never an override.
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

// As plain bools, a job that switched one off could not be told from one that
// never mentioned it, and the default would switch it back on.
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

// A job that runs only when asked writes its schedule empty, and the default
// schedule must not start running it on the clock.
func TestAnEmptyScheduleIsAnAnswerAndNotAnAbsence(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"schedule": "0 3 * * *"},
		"jobs": [
			{"name":"asked","schedule":"",`+sides+`},
			{"name":"quiet",`+sides+`}
		]
	}`)

	asked, _ := cfg.Find("asked")
	if asked.Schedule != "" {
		t.Errorf("a job that runs only when asked took the default schedule %q", asked.Schedule)
	}
	quiet, _ := cfg.Find("quiet")
	if quiet.Schedule != "0 3 * * *" {
		t.Errorf("a job without a schedule of its own got %q, the default said 0 3 * * *", quiet.Schedule)
	}
}

// There is no "apply to existing jobs": a job without a value of its own runs
// with whatever the default is after the change.
func TestAChangedDefaultReachesEveryJobThatFollowsIt(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"schedule": "0 3 * * *", "emptyDirs": false},
		"jobs": [
			{"name":"follows",`+sides+`},
			{"name":"own","schedule":"0 5 * * *","emptyDirs":false,`+sides+`}
		]
	}`)

	next, err := cfg.SaveSettings(map[string]any{
		"defaults": map[string]any{"schedule": "@every 2h", "emptyDirs": true},
	})
	if err != nil {
		t.Fatalf("save the defaults: %v", err)
	}
	follows, _ := next.Find("follows")
	if follows.Schedule != "@every 2h" || follows.EmptyDirs == nil || !*follows.EmptyDirs {
		t.Errorf("the job that follows did not take the new default: schedule %q, emptyDirs %v", follows.Schedule, follows.EmptyDirs)
	}
	own, _ := next.Find("own")
	if own.Schedule != "0 5 * * *" || own.EmptyDirs == nil || *own.EmptyDirs {
		t.Errorf("the new default overrode a job's own values: schedule %q, emptyDirs %v", own.Schedule, own.EmptyDirs)
	}
}

// Direction and mode are one setting, as the editor shows them. A job that
// writes either holds both, and a default mirror never reaches a job that
// picked its own direction.
func TestDirectionAndModeAreInheritedTogether(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"direction": "leftToRight", "mode": "mirror"},
		"jobs": [
			{"name":"follows",`+sides+`},
			{"name":"back","direction":"rightToLeft",`+sides+`},
			{"name":"both","direction":"both",`+sides+`}
		]
	}`)
	for _, c := range []struct{ name, direction, mode string }{
		{"follows", "leftToRight", "mirror"},
		{"back", "rightToLeft", ""},
		{"both", "both", ""},
	} {
		j, _ := cfg.Find(c.name)
		if j.Direction != c.direction || j.Mode != c.mode {
			t.Errorf("%s runs %q in mode %q, want %q in mode %q", c.name, j.Direction, j.Mode, c.direction, c.mode)
		}
		if err := j.Refused(); err != nil {
			t.Errorf("%s was refused: %v", c.name, err)
		}
	}
}

// A mirror without a direction of its own would delete on whichever side the
// default names, and change sides with it.
func TestAMirrorWithoutItsOwnDirectionIsRefusedAlone(t *testing.T) {
	cfg := write(t, `{
		"defaults": {"direction": "leftToRight"},
		"jobs": [
			{"name":"mirror","mode":"mirror",`+sides+`},
			{"name":"plain",`+sides+`}
		]
	}`)
	j, _ := cfg.Find("mirror")
	if j.Direction == "leftToRight" {
		t.Error("the mirror took its direction from the default")
	}
	if err := j.Refused(); err == nil || !strings.Contains(err.Error(), "one-way direction") {
		t.Errorf("a mirror running both ways was not refused: %v", err)
	}
	if plain, _ := cfg.Find("plain"); plain.Refused() != nil {
		t.Errorf("the job beside it was refused too: %v", plain.Refused())
	}
}

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

// The override stays a pointer all the way to the engine, so "not set" (ask
// the backends) can be told from false (match case exactly).
func TestTheCaseOverrideReachesTheEngine(t *testing.T) {
	yes := write(t, `{
		"jobs": [{"name":"x","foldCase":true,`+sides+`}]
	}`)
	if yes.Jobs[0].FoldCase == nil || !*yes.Jobs[0].FoldCase {
		t.Fatalf("foldCase true did not survive loading: %v", yes.Jobs[0].FoldCase)
	}
	opt, err := yes.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if opt.ForceFoldCase == nil || !*opt.ForceFoldCase {
		t.Errorf("the override did not reach the engine: %v", opt.ForceFoldCase)
	}

	// And the ordinary job asks the backends rather than being told.
	plain := write(t, `{"jobs": [{"name":"x",`+sides+`}]}`)
	plainOpt, err := plain.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if plainOpt.ForceFoldCase != nil {
		t.Errorf("a job that said nothing arrived with an override: %v", plainOpt.ForceFoldCase)
	}

	// A default reaches a job that says nothing, and loses to one that does.
	mixed := write(t, `{
		"defaults": {"foldCase": true},
		"jobs": [{"name":"a",`+sides+`},{"name":"b","foldCase":false,`+sides+`}]
	}`)
	if mixed.Jobs[0].FoldCase == nil || !*mixed.Jobs[0].FoldCase {
		t.Errorf("the default did not reach the quiet job: %v", mixed.Jobs[0].FoldCase)
	}
	if mixed.Jobs[1].FoldCase == nil || *mixed.Jobs[1].FoldCase {
		t.Errorf("a job that said false was overridden by the default: %v", mixed.Jobs[1].FoldCase)
	}
}

func TestANamedExcludeSetReachesTheJobThatAsksForIt(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"junk": ["*.tmp", "Thumbs.db"], "media": ["*.iso"]},
		"jobs": [{"name":"x","exclude":["own.txt"],"excludeSets":["junk"],`+sides+`}]
	}`)

	got := cfg.Jobs[0].Exclude
	want := map[string]bool{"own.txt": true, "*.tmp": true, "Thumbs.db": true}
	if len(got) != len(want) {
		t.Fatalf("the job ended up with %v", got)
	}
	for _, p := range got {
		if !want[p] {
			t.Errorf("unexpected pattern %q; the media set was not asked for", p)
		}
	}
}

// A set adds to the job's own list rather than replacing it.
func TestTheJobsOwnPatternsAreKept(t *testing.T) {
	cfg := write(t, `{
		"excludeSets": {"junk": ["*.tmp"]},
		"jobs": [{"name":"x","exclude":["private/**"],"excludeSets":["junk"],`+sides+`}]
	}`)
	var found bool
	for _, p := range cfg.Jobs[0].Exclude {
		if p == "private/**" {
			found = true
		}
	}
	if !found {
		t.Errorf("the job's own pattern was lost: %v", cfg.Jobs[0].Exclude)
	}
}

// A filter that silently matches nothing would sync what somebody asked to
// leave alone.
func TestASetNobodyDefinedIsRefused(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	body := `{
		"excludeSets": {"junk": ["*.tmp"]},
		"jobs": [{"name":"x","excludeSets":["typo"],` + sides + `}]
	}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, err := job.Load(path)
	if err == nil {
		t.Fatal("a job asking for a set that does not exist was accepted")
	}
	if !strings.Contains(err.Error(), "typo") {
		t.Errorf("the refusal does not name the set that is missing: %v", err)
	}
}
