package web_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestForgettingAJobsStateTakesItsSiblings.
//
// SQLite writes two files beside the database and both outlive it. A leftover
// -wal is not merely untidy: the next database created under the same name can
// be opened against somebody else's write-ahead log.
func TestForgettingAJobsStateTakesItsSiblings(t *testing.T) {
	h := newHarness(t)

	var cfg struct {
		Jobs []map[string]any `json:"jobs"`
	}
	getJSON(t, h.srv, "/api/config", &cfg)
	if len(cfg.Jobs) == 0 {
		t.Fatal("the harness has no job to work with")
	}
	name, _ := cfg.Jobs[0]["name"].(string)
	state, _ := cfg.Jobs[0]["state"].(string)
	if name == "" || state == "" {
		t.Fatalf("job has no name or no state: %+v", cfg.Jobs[0])
	}
	if !filepath.IsAbs(state) {
		state = filepath.Join(h.dir, state)
	}

	// Every one of the three, so the test can tell "removed the database" from
	// "removed the database and its log".
	made := []string{state, state + "-wal", state + "-shm"}
	if err := os.MkdirAll(filepath.Dir(state), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, p := range made {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	resp, body := doJSON(t, h.srv, http.MethodDelete, "/api/jobs/"+name+"/state", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("deleting the state: %s %s", resp.Status, body)
	}
	for _, p := range made {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s survived", filepath.Base(p))
		}
	}

	// Already gone is the state the caller asked for, so a second call is not
	// an error. A route that failed here would make "delete the job" fail on a
	// job whose database was never created.
	if resp, body := doJSON(t, h.srv, http.MethodDelete, "/api/jobs/"+name+"/state", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("deleting it twice: %s %s", resp.Status, body)
	}
}

// TestForgettingTheStateOfAJobThatIsNotThere.
//
// The NAME is what comes in, and the path is resolved from the configuration.
// A name nothing matches has to be refused rather than turned into a path, or
// the resolution step is not doing the job it exists for.
func TestForgettingTheStateOfAJobThatIsNotThere(t *testing.T) {
	h := newHarness(t)
	resp, _ := doJSON(t, h.srv, http.MethodDelete, "/api/jobs/no-such-job/state", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("an unknown job answered %s rather than saying there is no such job", resp.Status)
	}
}

// TestMakingAFolderTakesANameAndNeverAPath.
//
// This is the whole guard. The control says "make a folder here", so the parent
// is a folder the caller has already walked to and the name is one segment. A
// separator or a dot segment is REFUSED rather than cleaned, because cleaning a
// name that was never meant to be a path is how a control that says "here"
// quietly makes one somewhere else.
func TestMakingAFolderTakesANameAndNeverAPath(t *testing.T) {
	h := newHarness(t)
	parent := t.TempDir()

	refused := []string{
		"..",
		".",
		"../escaped",
		"sub/deeper",
		`sub\deeper`,
		"",
		"   ",
	}
	for _, name := range refused {
		body, _ := json.Marshal(map[string]string{"parent": parent, "name": name})
		resp, said := doJSON(t, h.srv, http.MethodPost, "/api/browse/mkdir", string(body))
		if resp.StatusCode == http.StatusOK {
			t.Errorf("%q was accepted as a folder name", name)
		}
		_ = said
	}

	// Nothing landed beside the parent, which is the failure the refusals
	// exist to prevent and the one a status code alone would not catch.
	beside, err := os.ReadDir(filepath.Dir(parent))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range beside {
		if strings.Contains(e.Name(), "escaped") {
			t.Errorf("something called %q appeared beside the parent", e.Name())
		}
	}
	if entries, err := os.ReadDir(parent); err != nil {
		t.Fatal(err)
	} else if len(entries) != 0 {
		t.Errorf("the parent is not empty after only refusals: %v", entries)
	}

	// And an ordinary name works, so the refusals above are a filter rather
	// than a wall.
	body, _ := json.Marshal(map[string]string{"parent": parent, "name": "Fotos"})
	resp, said := doJSON(t, h.srv, http.MethodPost, "/api/browse/mkdir", string(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("an ordinary name was refused: %s %s", resp.Status, said)
	}
	if info, err := os.Stat(filepath.Join(parent, "Fotos")); err != nil || !info.IsDir() {
		t.Errorf("the folder was not made: %v", err)
	}
}

// TestMakingAFolderIsNotRecursive.
//
// A parent that does not exist is an error rather than a tree appearing out of
// nowhere: the parent is meant to be a folder somebody has already walked to.
func TestMakingAFolderIsNotRecursive(t *testing.T) {
	h := newHarness(t)
	missing := filepath.Join(t.TempDir(), "not", "there")

	body, _ := json.Marshal(map[string]string{"parent": missing, "name": "Fotos"})
	resp, _ := doJSON(t, h.srv, http.MethodPost, "/api/browse/mkdir", string(body))
	if resp.StatusCode == http.StatusOK {
		t.Error("a folder was made under a parent that does not exist")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Error("the missing parent was created")
	}
}

// TestDeletingTheLastJobReachesTheFile.
//
// The bug this exists for had two layers and the second was the real one. The
// editor changed its own list and never wrote the file, so a removal survived
// until the next read; that was fixed first. Underneath it, the validator
// refused a configuration with no jobs at all, so removing the ONLY job could
// never be written even once the write was attempted. A fresh install has
// exactly one job, which is why "den example auftrag kann ich nicht löschen"
// was reported against the only job there is.
//
// The test goes through the API rather than the validator, because that is the
// path that was broken: each half passed its own tests while the two together
// could not delete a job.
func TestDeletingTheLastJobReachesTheFile(t *testing.T) {
	h := newHarness(t)

	var before struct {
		Jobs []map[string]any `json:"jobs"`
	}
	getJSON(t, h.srv, "/api/config", &before)
	if len(before.Jobs) != 1 {
		t.Fatalf("this test needs exactly one job to remove, found %d", len(before.Jobs))
	}

	if resp, said := putJSON(t, h.srv, "/api/config", `{"jobs":[]}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("removing the only job: %s %s", resp.Status, said)
	}

	// Read back from the server, which re-reads the file, so this cannot pass
	// on a list the browser is merely holding.
	var after struct {
		Jobs []map[string]any `json:"jobs"`
	}
	getJSON(t, h.srv, "/api/config", &after)
	if len(after.Jobs) != 0 {
		t.Errorf("the job came back: %+v", after.Jobs)
	}
}
