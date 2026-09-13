package job

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A job pointing at one place twice is refused, and until now nothing stopped it.
//
// The hazard is not theoretical. With mode `move`, a job whose destination IS
// its source carries every file to where it already is and then removes it from
// the source, which is the same place. With `mirror`, the destination's extra
// files are the source's own files. Sync is merely nonsense; the other two
// delete.
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
		// The ordinary shapes have to keep working, and the nested case is
		// deliberately NOT caught: see the comment at the guard.
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

// A draft with no sides at all is still allowed through.
//
// That is the state the editor's own "add a job" button produces, and the guard
// above must not turn an empty new job into a file the program refuses to read.
func TestADraftWithNoSidesIsNotASnake(t *testing.T) {
	if err := loadWithSides(t, "", ""); err != nil {
		t.Errorf("an empty draft was refused: %v", err)
	}
}

// And a switched-off job with both sides the same is refused too.
//
// Being switched off excuses a job from being COMPLETE; it does not make a
// destructive shape safe, because switching it on is one tap. The half-written
// rule above deliberately lets a disabled job miss a side; this one deliberately
// does not.
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

// quote is enough JSON escaping for the paths these tests use, and a backslash
// in a Windows path is exactly the character that would otherwise turn the
// fixture into a parse error rather than a test.
func quote(s string) string { return `"` + strings.ReplaceAll(s, `\`, `\\`) + `"` }

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}
