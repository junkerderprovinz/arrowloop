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

// TestLoadResolvesPathsAgainstTheFile covers the trap of running a daemon from
// a directory nobody chose.
//
// A service manager starts the process wherever it likes, usually the root of
// the filesystem. A relative state path in the configuration would then resolve
// somewhere else entirely, and the job would find an empty record and treat
// every file on both sides as new.
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

// TestLoadRefusesBrokenConfigurations checks everything at load time rather than
// at three in the morning on the one job that mattered.
func TestLoadRefusesBrokenConfigurations(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"no jobs at all", `{"jobs":[]}`, "no jobs"},
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

// TestMisspelledFieldIsRefused deserves its own note. JSON decoding normally
// ignores a field it does not recognise, so "excludes" instead of "exclude"
// would leave the filter silently empty and the job would sync the very files
// the user thought they had excluded. DisallowUnknownFields turns that into an
// error at load time.
func TestMisspelledFieldIsRefused(t *testing.T) {
	_, err := Load(writeConfig(t, `{"jobs":[{"name":"x","left":"/a","right":"/b","state":"s.db","emptyDir":true}]}`))
	if err == nil {
		t.Fatal("a misspelled field was ignored, which would silently drop the setting")
	}
}

// TestZeroBrakeIsNotTheSameAsUnset is why those two fields are pointers.
//
// Zero switches the mass-delete brake off completely. That has to be something
// somebody typed on purpose, never something they got by leaving a field out.
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

// TestOptionsFillInTheDefaults checks that leaving a field out means the
// engine's default rather than a zero value.
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
	// The in-progress names come along unless they are explicitly refused,
	// because a half-written download is never worth copying.
	if !opt.Exclude.Excluded("movie.mkv.part") {
		t.Error("the default excludes were dropped")
	}
}
