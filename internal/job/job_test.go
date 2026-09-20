package job

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

// A service manager starts the daemon wherever it likes, and a state path
// resolved against that directory would give the job an empty record.
func TestLoadResolvesPathsAgainstTheFile(t *testing.T) {
	path := writeConfig(t, `{
	  "jobs": [{"name":"photos","left":"/a","right":"/b","state":"state/photos.db"}]
	}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	want := filepath.Join(filepath.Dir(path), "state", "photos.db")
	if cfg.Jobs[0].State != want {
		t.Errorf("state resolved to %q, want %q", cfg.Jobs[0].State, want)
	}
	if cfg.History != filepath.Join(filepath.Dir(path), "history.db") {
		t.Errorf("history landed at %q", cfg.History)
	}
	if cfg.ParallelJobs != 1 {
		t.Errorf("parallelJobs defaulted to %d, want 1", cfg.ParallelJobs)
	}
}

func TestLoadRefusesBrokenConfigurations(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"a job with no name", `{"jobs":[{"left":"/a","right":"/b","state":"s.db"}]}`, "no name"},
		{"two jobs with one name", `{"jobs":[
			{"name":"x","left":"/a","right":"/b","state":"s.db"},
			{"name":"x","left":"/c","right":"/d","state":"t.db"}]}`, "both called"},
		{"only one side", `{"jobs":[{"name":"x","left":"/a","state":"s.db"}]}`, "left and a right"},
		{"no state database", `{"jobs":[{"name":"x","left":"/a","right":"/b"}]}`, "state database"},
		{"a schedule cron cannot read", `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","schedule":"every tuesday"}]}`, "schedule"},
		{"a duration nobody can parse", `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","quietPeriod":"soon"}]}`, "quietPeriod"},
		{"a misspelled field", `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","excludes":["*.tmp"]}]}`, "excludes"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Load(writeConfig(t, tc.body))
			if err == nil {
				t.Fatal("this configuration was accepted")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("the message does not mention %q, so it does not help: %v", tc.want, err)
			}
		})
	}
}

// Ignoring an unknown field would turn "excludes" for "exclude" into a filter
// that silently matches nothing.
func TestMisspelledFieldIsRefused(t *testing.T) {
	_, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","emptyDir":true}]}`))
	if err == nil {
		t.Fatal("a misspelled field was ignored, which would silently drop the setting")
	}
}

func TestZeroBrakeIsNotTheSameAsUnset(t *testing.T) {
	unset, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db"}]}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	opt, err := unset.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if opt.Compare.BrakePercent != 50 {
		t.Errorf("leaving brakePercent out gave %d, want the default of 50", opt.Compare.BrakePercent)
	}

	off, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","brakePercent":0}]}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	opt, err = off.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if opt.Compare.BrakePercent != 0 {
		t.Errorf("an explicit 0 gave %d; the brake could not be switched off", opt.Compare.BrakePercent)
	}
}

func TestOptionsFillInTheDefaults(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[{
	  "name":"x","left":"/a","right":"/b","state":"s.db",
	  "quietPeriod":"30s","transfers":9,"emptyDirs":true,"metadata":true,
	  "exclude":["*.log"]
	}]}`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	opt, err := cfg.Jobs[0].Options()
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if opt.Compare.QuietPeriod != 30*time.Second {
		t.Errorf("quiet period is %s", opt.Compare.QuietPeriod)
	}
	if opt.Compare.Transfers != 9 {
		t.Errorf("transfers is %d", opt.Compare.Transfers)
	}
	if opt.Compare.ModWindow == 0 {
		t.Error("the modification window was left at zero instead of the default")
	}
	if !opt.EmptyDirs || !opt.Metadata {
		t.Error("emptyDirs or metadata did not survive")
	}
	if !opt.Exclude.Excluded("deep/inside/app.log") {
		t.Error("the exclude pattern did not reach the filter")
	}
	if !opt.Exclude.Excluded("movie.mkv.part") {
		t.Error("the default excludes were dropped")
	}
}

// The editor's "add a job" button saves a job with a name, a state file and no
// sides, and the desktop starter configuration holds one.
func TestAHalfWrittenJobCanBeSavedButNotRun(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	body := `{"jobs":[{"name":"not-finished-yet","left":"","right":"","state":"state/x.db","disabled":true}]}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("a switched-off job with no sides was refused, so nothing can create one: %v", err)
	}
	if len(cfg.Jobs) != 1 {
		t.Fatalf("expected the job to survive loading, got %d", len(cfg.Jobs))
	}

	// Switched on with no sides it is still a draft: it has no schedule, and
	// the runner refuses it by hand with ErrHalfWritten.
	body = `{"jobs":[{"name":"not-finished-yet","left":"","right":"","state":"state/x.db"}]}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := Load(path); err != nil {
		t.Fatalf("a switched-on job with neither side is a draft and must load: %v", err)
	}
}

// A job with one side is half a form filled in, and switched on it would run
// and do something surprising.
func TestAJobWithOneSideIsStillRefused(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")

	for _, half := range []string{
		`{"jobs":[{"name":"half","left":"/data","right":"","state":"state/x.db"}]}`,
		`{"jobs":[{"name":"half","left":"","right":"/backup","state":"state/x.db"}]}`,
	} {
		if err := os.WriteFile(path, []byte(half), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		if _, err := Load(path); err == nil {
			t.Fatalf("a switched-on job with one side was accepted: %s", half)
		}
	}

	held := `{"jobs":[{"name":"half","left":"/data","right":"","state":"state/x.db","disabled":true}]}`
	if err := os.WriteFile(path, []byte(held), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := Load(path); err != nil {
		t.Fatalf("a held job with one side must still load: %v", err)
	}
}

// An empty list is what the editor saves after the last job is deleted.
func TestAConfigurationWithNoJobsIsAccepted(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[]}`))
	if err != nil {
		t.Fatalf("an empty job list was refused: %v", err)
	}
	if len(cfg.Jobs) != 0 {
		t.Errorf("expected no jobs, got %d", len(cfg.Jobs))
	}
}
