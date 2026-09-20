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
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	write(t, path, `{"jobs":[{"name":"Schlange","disabled":true,"left":"/fotos","right":"/fotos","state":"state/x.db"}]}`)
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "snake eating its own tail") {
		t.Errorf("a disabled job with one place on both sides was accepted: %v", err)
	}
}

func loadWithSides(t *testing.T, left, right string) error {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	write(t, path, `{"jobs":[{"name":"Test","left":`+quote(left)+`,"right":`+quote(right)+`,"state":"state/x.db"}]}`)
	_, err := Load(path)
	return err
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
