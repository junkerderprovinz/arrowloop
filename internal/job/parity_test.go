package job_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var (
	// `json:"name,omitempty"` -> name
	goTag = regexp.MustCompile(`json:"([a-zA-Z][a-zA-Z0-9]*)`)
	// `  watchSettle?: string` -> watchSettle
	tsField = regexp.MustCompile(`(?m)^  ([a-zA-Z][a-zA-Z0-9]*)\??:`)
)

// block returns the source between a start marker and the first line that is
// exactly a closing brace, which is how both a Go struct and a TS type end.
func block(t *testing.T, path, start string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	text := string(body)
	at := strings.Index(text, start)
	if at < 0 {
		t.Fatalf("%s does not contain %q; if it was renamed, this test has to be told", path, start)
	}
	rest := text[at:]
	end := strings.Index(rest, "\n}")
	if end < 0 {
		t.Fatalf("cannot find the end of %q in %s", start, path)
	}
	return rest[:end]
}

// A field the interface offers and the Go struct lacks makes the configuration
// refuse the whole file with "unknown field". The other direction is fine: the
// form does not carry every knob.
func TestTheInterfaceNeverOffersAFieldTheConfigurationWouldRefuse(t *testing.T) {
	root := filepath.Join("..", "..")

	goFields := map[string]bool{}
	for _, m := range goTag.FindAllStringSubmatch(block(t, filepath.Join(root, "internal", "job", "job.go"), "type Job struct {"), -1) {
		goFields[m[1]] = true
	}
	if len(goFields) < 10 {
		t.Fatalf("only found %d fields on the Go struct, so the scanner is broken rather than the code", len(goFields))
	}

	tsFields := map[string]bool{}
	for _, m := range tsField.FindAllStringSubmatch(block(t, filepath.Join(root, "web", "src", "lib", "api.ts"), "export type RawJob = {"), -1) {
		tsFields[m[1]] = true
	}
	if len(tsFields) < 10 {
		t.Fatalf("only found %d fields on the TypeScript type, so the scanner is broken rather than the code", len(tsFields))
	}

	var ghosts []string
	for name := range tsFields {
		if !goFields[name] {
			ghosts = append(ghosts, name)
		}
	}
	sort.Strings(ghosts)
	if len(ghosts) > 0 {
		t.Fatalf("the interface offers %v, which internal/job does not accept. "+
			"Saving a job with any of them makes the parser refuse the whole configuration "+
			"with \"unknown field\", so this is not one ignored setting but a broken file. "+
			"Either add the field to the Job struct or take it off the type.", ghosts)
	}
}
