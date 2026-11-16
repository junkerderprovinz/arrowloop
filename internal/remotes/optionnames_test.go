package remotes_test

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"

	_ "github.com/rclone/rclone/backend/all"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// The forms label each option from a table in the web app. An rclone update
// that brings a new option fails here rather than showing its raw name.
func TestEveryOptionHasAReadableName(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "web", "src", "lib", "optionNames.ts"))
	if err != nil {
		t.Fatal(err)
	}
	named := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^  '?([a-z0-9_]+)'?: 'opt\.`).FindAllSubmatch(source, -1) {
		named[string(m[1])] = true
	}
	if len(named) < 100 {
		t.Fatalf("read only %d names from optionNames.ts, the pattern is wrong", len(named))
	}

	for _, b := range remotes.Backends() {
		for _, o := range b.Options {
			if !named[o.Name] {
				t.Errorf("%s option %s has no name in web/src/lib/optionNames.ts", b.Name, o.Name)
			}
		}
	}
}
