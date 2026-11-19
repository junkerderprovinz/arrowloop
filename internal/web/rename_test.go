package web_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// jobID is the id the harness's engine gave the job called name, which a run
// written straight into the log has to carry.
func jobID(t *testing.T, h *harness, name string) string {
	t.Helper()
	j, ok := h.runner.Config().Find(name)
	if !ok {
		t.Fatalf("no job called %q", name)
	}
	return j.ID
}

// runTwice gives the harness's job two recorded runs.
func runTwice(t *testing.T, h *harness) {
	t.Helper()
	runTwiceFrom(t, h, h.left)
}

// runTwiceFrom is runTwice for a job whose left side is left.
func runTwiceFrom(t *testing.T, h *harness, left string) {
	t.Helper()
	for i, name := range []string{"a.txt", "b.txt"} {
		write(t, left, name, "hello")
		h.post(t, "/api/jobs/photos/run", ``).Body.Close()
		waitForRun(t, h, i+1)
	}
}

// rename saves the job called from under the name to, the way the editor
// does: the whole list as the file holds it, with one name changed.
func rename(t *testing.T, h *harness, from, to string) map[string]any {
	t.Helper()
	var file struct{ Jobs []map[string]any }
	h.get(t, "/api/config", &file)
	var renamed map[string]any
	for _, j := range file.Jobs {
		if j["name"] == from {
			j["name"] = to
			renamed = j
		}
	}
	if renamed == nil {
		t.Fatalf("no job called %q in %v", from, file.Jobs)
	}
	body, _ := json.Marshal(file)
	if resp, out := h.put(t, "/api/config", string(body)); resp.StatusCode != http.StatusOK {
		t.Fatalf("the rename was refused: %s %s", resp.Status, out)
	}
	return renamed
}

func TestARenamedJobKeepsItsHistoryAndWhatItLearned(t *testing.T) {
	h := newHarness(t)
	runTwice(t, h)
	rename(t, h, "photos", "pictures")

	var jobs []struct {
		Name   string
		Recent []history.Run
	}
	h.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || jobs[0].Name != "pictures" || len(jobs[0].Recent) != 2 {
		t.Fatalf("the job list after the rename = %+v, want pictures with both runs", jobs)
	}

	var runs []history.Run
	h.get(t, "/api/history?job=pictures", &runs)
	if len(runs) != 2 {
		t.Fatalf("the log of pictures holds %d runs, want the two from before the rename", len(runs))
	}
	for _, r := range runs {
		if r.Job != "pictures" {
			t.Errorf("a run from before the rename is listed under %q", r.Job)
		}
	}

	var learning []struct {
		Job  string
		Runs int
	}
	h.get(t, "/api/anomalies/learning", &learning)
	if len(learning) != 1 || learning[0].Job != "pictures" || learning[0].Runs != 2 {
		t.Errorf("learning after the rename = %+v, want pictures still knowing both runs", learning)
	}
}

func TestAJobAnswersToItsIDAsWellAsItsName(t *testing.T) {
	h := newHarness(t)
	runTwice(t, h)
	renamed := rename(t, h, "photos", "pictures")
	id, _ := renamed["id"].(string)
	if id == "" {
		t.Fatalf("the job carries no id: %v", renamed)
	}

	for _, ref := range []string{"pictures", id} {
		resp, err := h.srv.Client().Get(h.srv.URL + "/api/jobs/" + url.PathEscape(ref) + "/plan")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("planning by %q = %s, want the job", ref, resp.Status)
		}
	}
	var runs []history.Run
	h.get(t, "/api/history?job="+url.QueryEscape(id), &runs)
	if len(runs) != 2 {
		t.Errorf("the log asked for by id holds %d runs, want 2", len(runs))
	}
}

func TestTheJobListCarriesEachJobsID(t *testing.T) {
	h := newHarness(t)
	var file struct{ Jobs []map[string]any }
	h.get(t, "/api/config", &file)
	var jobs []struct{ ID, Name string }
	h.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || len(file.Jobs) != 1 || jobs[0].ID == "" || jobs[0].ID != file.Jobs[0]["id"] {
		t.Errorf("the job list says %+v and the file %v, want the same id in both", jobs, file.Jobs)
	}
}

func TestAJobRenamedFromAPairedInstanceKeepsItsIDAndHistory(t *testing.T) {
	config, left, _ := apart(t)
	a, b, _, bID := pairedPair(t, config)
	runTwiceFrom(t, b.harness, left)

	got := openOn(t, a, bID, "photos")
	id, _ := got.Job["id"].(string)
	if id == "" {
		t.Fatalf("the job arrives without its id: %v", got.Job)
	}
	got.Job["name"] = "pictures"
	got.Job["id"] = "ffffffffffff"
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("renaming the job on the other instance = %d %s", status, body)
	}

	var jobs []struct {
		ID, Name string
		Recent   []history.Run
	}
	b.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || jobs[0].ID != id || jobs[0].Name != "pictures" || len(jobs[0].Recent) != 2 {
		t.Fatalf("the owner lists %+v, want pictures with the id it had and both runs", jobs)
	}

	if again := openOn(t, a, bID, id); again.Job["name"] != "pictures" {
		t.Errorf("the job opened by its id is %v, want the renamed one", again.Job)
	}
	if status, body := a.send(t, http.MethodPost, "/api/instances/"+bID+"/jobs/"+id+"/run", ""); status != http.StatusAccepted {
		t.Errorf("running the job by its id = %d %s", status, body)
	}
	waitForRun(t, b.harness, 3)
}
