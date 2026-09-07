package job_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// The example configuration has to load.
//
// The README points at it as the complete one, so it is the first file anybody
// copies, and a broken example is worse than none: somebody edits their paths
// into it, the daemon refuses to start, and the thing they mistrust is their own
// typing rather than the file they were handed.
//
// It has aged out of true before. Every setting added since it was written was
// added somewhere else, and nothing said so, because a JSON file that nobody
// parses in CI is a file that is correct until somebody tries it.
//
// The load goes through job.Load, which is the same function that guards a
// hand-written file, so this fails for exactly the reasons a person's own file
// would fail.
func TestTheExampleConfigurationLoads(t *testing.T) {
	path := filepath.Join("..", "..", "arrowloop.example.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the example: %v", err)
	}

	// Loaded from a COPY in a sandbox, because Load resolves relative paths
	// against the file's own directory and a state path of "state/photos.db"
	// would otherwise be resolved against the repository root. Nothing is
	// created by loading, but resolving against the real tree would make the
	// test's meaning depend on where the repository happens to sit.
	dir := t.TempDir()
	copied := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(copied, raw, 0o644); err != nil {
		t.Fatalf("copy: %v", err)
	}

	cfg, err := job.Load(copied)
	if err != nil {
		t.Fatalf("the example configuration is refused by the loader: %v", err)
	}
	if len(cfg.Jobs) == 0 {
		t.Fatal("the example configuration has no jobs, which is not an example of anything")
	}
}

// TestTheExampleShowsTheSettingsItIsPointedAtFor.
//
// Not pedantry about coverage. The example is documentation that happens to be
// executable, and a setting missing from it is a setting somebody has to find
// out about from the source. Every name here is one that was added after the
// example was first written and had to be put back into it by hand, which is
// exactly the drift this catches next time.
func TestTheExampleShowsTheSettingsItIsPointedAtFor(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "arrowloop.example.json"))
	if err != nil {
		t.Fatalf("read the example: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("the example is not valid JSON: %v", err)
	}

	for _, key := range []string{"defaults", "excludeSets", "bwlimit", "notify"} {
		if _, has := doc[key]; !has {
			t.Errorf("the example never mentions %q", key)
		}
	}

	jobs, _ := doc["jobs"].([]any)
	seen := map[string]bool{}
	for _, entry := range jobs {
		j, _ := entry.(map[string]any)
		for k := range j {
			seen[k] = true
		}
	}
	for _, key := range []string{"excludeSets", "firstRun", "keepVersions", "reportOnly", "foldCase"} {
		if !seen[key] {
			t.Errorf("no job in the example shows %q", key)
		}
	}
}
