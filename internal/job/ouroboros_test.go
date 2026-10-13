package job

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A move job whose destination is its source would remove every file from the
// place it just copied it to.
func TestBothSidesInOnePlaceIsRefused(t *testing.T) {
	for _, c := range []struct {
		name        string
		left, right string
		refused     bool
	}{
		{"the same path typed twice", "/fotos", "/fotos", true},
		{"one of them with a trailing slash", "/fotos", "/fotos/", true},
		{"a trailing backslash", `C:\Fotos`, `C:\Fotos\`, true},
		{"whitespace somebody did not see", "/fotos", "  /fotos  ", true},
		{"the same remote and bucket", "Garage:eimer", "Garage:eimer", true},
		{"the root of one filesystem", "/", "/", true},
		// The nested case is not caught; see the comment at the guard.
		{"two different folders", "/fotos", "/sicherung", false},
		{"one inside the other, which this does not claim to catch", "/fotos", "/fotos/2026", false},
		{"same name on two backends", "Garage:eimer", "Wasabi:eimer", false},
		{"a case difference, which the backends disagree about", "/Fotos", "/fotos", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			err := loadWithSides(t, c.left, c.right)
			refused := err != nil && strings.Contains(err.Error(), "snake eating its own tail")
			if refused != c.refused {
				t.Errorf("left=%q right=%q refused=%v, want %v (err: %v)", c.left, c.right, refused, c.refused, err)
			}
		})
	}
}

// The editor's "add a job" button produces a job with no sides.
func TestADraftWithNoSidesIsNotASnake(t *testing.T) {
	if err := loadWithSides(t, "", ""); err != nil {
		t.Errorf("an empty draft was refused: %v", err)
	}
}

// Being switched off excuses a job from being complete, not from a destructive
// shape, because switching it on is one tap.
func TestSwitchingItOffDoesNotExcuseIt(t *testing.T) {
	cfg := loadBody(t, `{"jobs":[{"name":"Schlange","disabled":true,"left":"/fotos","right":"/fotos","state":"state/x.db"}]}`)
	j, _ := cfg.Find("Schlange")
	if err := j.Refused(); err == nil || !strings.Contains(err.Error(), "snake eating its own tail") {
		t.Errorf("a disabled job with one place on both sides was not refused: %v", err)
	}
}

// One job that cannot run must not keep the program from starting, or every
// other job stops with it.
func TestASnakeIsRefusedAloneAndTheOthersLoad(t *testing.T) {
	cfg := loadBody(t, `{"jobs":[
		{"name":"Schlange","left":"/fotos","right":"/fotos","state":"state/x.db"},
		{"name":"Fotos","left":"/fotos","right":"/sicherung","state":"state/y.db"}
	]}`)
	snake, _ := cfg.Find("Schlange")
	if snake.Refused() == nil {
		t.Error("the job with one place on both sides was not refused")
	}
	fine, ok := cfg.Find("Fotos")
	if !ok || fine.Refused() != nil {
		t.Errorf("the job beside it was refused too: %v", fine.Refused())
	}
}

// A file that already holds a refused job can still be saved, while an edit
// that makes a job refused is turned down like any other bad edit.
func TestASaveIsRefusedOnlyForTheSnakeItMakes(t *testing.T) {
	cfg := loadBody(t, `{"jobs":[
		{"name":"Schlange","left":"/fotos","right":"/fotos","state":"state/x.db"},
		{"name":"Fotos","left":"/fotos","right":"/sicherung","state":"state/y.db"}
	]}`)
	if _, err := cfg.SaveSettings(map[string]any{"parallelJobs": 2.0}); err != nil {
		t.Errorf("a settings change was refused over a job it did not touch: %v", err)
	}
	jobs, err := cfg.JobsAsMaps()
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range jobs {
		if j["name"] == "Fotos" {
			j["right"] = "/fotos"
		}
	}
	if _, err := cfg.SaveJobs(jobs); err == nil || !strings.Contains(err.Error(), "snake eating its own tail") {
		t.Errorf("an edit that points a job at itself was saved: %v", err)
	}
}

// loadWithSides loads one job between two sides and returns why it would not
// load or would not run.
func loadWithSides(t *testing.T, left, right string) error {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	write(t, path, `{"jobs":[{"name":"Test","left":`+quote(left)+`,"right":`+quote(right)+`,"state":"state/x.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		return err
	}
	j, _ := cfg.Find("Test")
	return j.Refused()
}

func loadBody(t *testing.T, body string) *Config {
	t.Helper()
	path := filepath.Join(t.TempDir(), "arrowloop.json")
	write(t, path, body)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return cfg
}

// quote escapes the backslashes of a Windows path, which is all the JSON
// escaping these paths need.
func quote(s string) string { return `"` + strings.ReplaceAll(s, `\`, `\\`) + `"` }

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}
