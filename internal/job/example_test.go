package job_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// The README points at the example as the complete configuration, so it is the
// first file anybody copies.
func TestTheExampleConfigurationLoads(t *testing.T) {
	path := filepath.Join("..", "..", "arrowloop.example.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the example: %v", err)
	}

	// Load resolves relative paths against the file's directory, so a copy
	// keeps the result independent of where the repository sits.
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

// A setting missing from the example is one somebody has to find in the source.
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
	for _, key := range []string{"excludeSets", "keepVersions", "watch", "foldCase"} {
		if !seen[key] {
			t.Errorf("no job in the example shows %q", key)
		}
	}
}
