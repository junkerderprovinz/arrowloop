package web_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

func postJob(t *testing.T, h *harness, body string) (int, map[string]any) {
	t.Helper()
	resp := h.post(t, "/api/jobs", body)
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func jobBody(j map[string]any) string {
	raw, _ := json.Marshal(j)
	return string(raw)
}

func TestANewJobIsAddedBesideTheOthers(t *testing.T) {
	h := newHarness(t)
	body := jobBody(map[string]any{"name": "filme nach backup", "left": h.left, "right": h.right, "direction": "leftToRight", "mode": "mirror", "schedule": "0 3 * * *"})

	code, got := postJob(t, h, body)
	if code != http.StatusCreated {
		t.Fatalf("adding a job answered %d: %v", code, got)
	}
	if got["state"] != "state/filme nach backup.db" {
		t.Errorf("the job got no state database of its own: %v", got["state"])
	}

	cfg, err := job.Load(h.configPath)
	if err != nil {
		t.Fatalf("the file on disk does not load: %v", err)
	}
	if len(cfg.Jobs) != 2 {
		t.Fatalf("the file holds %d jobs, want the old one and the new one", len(cfg.Jobs))
	}
	added, ok := cfg.Find("filme nach backup")
	if !ok || added.Mode != "mirror" || added.Schedule != "0 3 * * *" {
		t.Errorf("the job on disk is not the one sent: %+v", added)
	}
	if _, ok := h.runner.Config().Find("filme nach backup"); !ok {
		t.Error("the running engine does not know the new job")
	}
}

func TestATakenNameIsNotOverwritten(t *testing.T) {
	h := newHarness(t)
	code, got := postJob(t, h, `{"name":"photos","left":"/x","right":"/y"}`)
	if code != http.StatusConflict {
		t.Fatalf("a job with a taken name answered %d: %v", code, got)
	}
	cfg, _ := job.Load(h.configPath)
	if j, _ := cfg.Find("photos"); strings.HasSuffix(j.Left, "/x") {
		t.Error("the existing job was replaced")
	}
}

func TestANameThatWouldLeaveTheStateFolderIsRefused(t *testing.T) {
	h := newHarness(t)
	for _, name := range []string{"", "../escape", `a\b`, "..", "tab\there"} {
		body := jobBody(map[string]any{"name": name, "left": h.left, "right": h.right})
		if code, got := postJob(t, h, body); code != http.StatusBadRequest {
			t.Errorf("name %q answered %d: %v", name, code, got)
		}
	}
}

func TestAJobTheValidatorRefusesLeavesTheFileAlone(t *testing.T) {
	h := newHarness(t)
	before, _ := os.ReadFile(h.configPath)
	code, got := postJob(t, h, `{"name":"half","left":"/only/one/side"}`)
	if code != http.StatusBadRequest {
		t.Fatalf("a job with one side answered %d: %v", code, got)
	}
	after, _ := os.ReadFile(h.configPath)
	if string(before) != string(after) {
		t.Error("a refused job still changed the file")
	}
}

// The commands run on this machine, so only the file itself may set them.
func TestANewJobCannotBringCommands(t *testing.T) {
	h := newHarness(t)
	body := jobBody(map[string]any{"name": "sneaky", "left": h.left, "right": h.right, "before": "rm -rf /"})
	if code, got := postJob(t, h, body); code != http.StatusCreated {
		t.Fatalf("adding the job answered %d: %v", code, got)
	}
	cfg, _ := job.Load(h.configPath)
	if j, _ := cfg.Find("sneaky"); j.Before != "" {
		t.Errorf("the job kept the command %q", j.Before)
	}
}

func TestJobsAddedAtOnceAllArrive(t *testing.T) {
	h := newHarness(t)
	var wg sync.WaitGroup
	for _, name := range []string{"a", "b", "c", "d", "e", "f"} {
		wg.Go(func() {
			body := jobBody(map[string]any{"name": name, "left": h.left, "right": h.right})
			if code, got := postJob(t, h, body); code != http.StatusCreated {
				t.Errorf("job %s answered %d: %v", name, code, got)
			}
		})
	}
	wg.Wait()
	cfg, _ := job.Load(h.configPath)
	if len(cfg.Jobs) != 7 {
		t.Errorf("the file holds %d jobs, want 7", len(cfg.Jobs))
	}
}
