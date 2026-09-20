package web_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A leftover -wal could be opened against the next database of the same name.
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

	// A job whose database was never created must still be deletable.
	if resp, body := doJSON(t, h.srv, http.MethodDelete, "/api/jobs/"+name+"/state", ""); resp.StatusCode != http.StatusOK {
		t.Errorf("deleting it twice: %s %s", resp.Status, body)
	}
}

// A name nothing matches is refused rather than turned into a path.
func TestForgettingTheStateOfAJobThatIsNotThere(t *testing.T) {
	h := newHarness(t)
	resp, _ := doJSON(t, h.srv, http.MethodDelete, "/api/jobs/no-such-job/state", "")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("an unknown job answered %s rather than saying there is no such job", resp.Status)
	}
}

// A separator or a dot segment is refused rather than cleaned, so the folder
// cannot land somewhere other than "here".
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

	// A status code alone would not show something landing beside the parent.
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

	body, _ := json.Marshal(map[string]string{"parent": parent, "name": "Fotos"})
	resp, said := doJSON(t, h.srv, http.MethodPost, "/api/browse/mkdir", string(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("an ordinary name was refused: %s %s", resp.Status, said)
	}
	if info, err := os.Stat(filepath.Join(parent, "Fotos")); err != nil || !info.IsDir() {
		t.Errorf("the folder was not made: %v", err)
	}
}

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

// A fresh install has exactly one job, and removing it has to reach the file.
// This goes through the API, where the editor and the validator meet.
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

	// The server re-reads the file.
	var after struct {
		Jobs []map[string]any `json:"jobs"`
	}
	getJSON(t, h.srv, "/api/config", &after)
	if len(after.Jobs) != 0 {
		t.Errorf("the job came back: %+v", after.Jobs)
	}
}
