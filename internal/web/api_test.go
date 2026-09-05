package web_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

type harness struct {
	srv   *httptest.Server
	left  string
	right string
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	body := fmt.Sprintf(`{"jobs":[{"name":"photos","left":%q,"right":%q,"state":%q,"quietPeriod":"0s"}]}`,
		filepath.ToSlash(left), filepath.ToSlash(right), filepath.ToSlash(filepath.Join(dir, "photos.db")))
	cfgPath := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(cfgPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := job.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })

	s := &web.Server{History: hist, Runner: daemon.New(cfg, hist, nil, nil)}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return &harness{srv: srv, left: left, right: right}
}

func (h *harness) get(t *testing.T, path string, into any) {
	t.Helper()
	resp, err := h.srv.Client().Get(h.srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: %s", path, resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

func (h *harness) post(t *testing.T, path, body string) *http.Response {
	t.Helper()
	resp, err := h.srv.Client().Post(h.srv.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return resp
}

func write(t *testing.T, dir, name, content string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// TestPreviewChangesNothing is the promise the whole screen rests on. Somebody
// opening a job to see what it would do must be able to close the tab again and
// find both folders exactly as they were.
func TestPreviewChangesNothing(t *testing.T) {
	h := newHarness(t)
	write(t, h.left, "a.txt", "hello")

	var view struct {
		Actions []struct {
			Path, Kind, From, To, Reason string
		}
	}
	h.get(t, "/api/jobs/photos/plan", &view)

	if len(view.Actions) != 1 {
		t.Fatalf("expected one proposed change, got %+v", view.Actions)
	}
	got := view.Actions[0]
	if got.Path != "a.txt" || got.Kind != "copy" || got.From != "left" || got.To != "right" {
		t.Errorf("the preview does not say what would happen: %+v", got)
	}
	if got.Reason == "" {
		t.Error("a proposed change with no reason is not something anybody can decide on")
	}
	if _, err := os.Stat(filepath.Join(h.right, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("asking for a preview moved a file")
	}
}

// TestRunOnlyTouchesWhatWasTicked is why the preview is worth having: the ticks
// have to mean something.
func TestRunOnlyTouchesWhatWasTicked(t *testing.T) {
	h := newHarness(t)
	write(t, h.left, "wanted.txt", "yes")
	write(t, h.left, "unwanted.txt", "no")

	resp := h.post(t, "/api/jobs/photos/run", `{"only":["wanted.txt"]}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("run: %s", resp.Status)
	}
	waitForRun(t, h, 1)

	if _, err := os.Stat(filepath.Join(h.right, "wanted.txt")); err != nil {
		t.Errorf("the ticked file did not cross: %v", err)
	}
	if _, err := os.Stat(filepath.Join(h.right, "unwanted.txt")); !os.IsNotExist(err) {
		t.Error("a file nobody ticked was synced anyway")
	}
}

// TestAnEmptySelectionDoesNothing separates "everything" from "nothing".
//
// An absent list means everything, and an empty list means exactly what it
// says. If those two collapsed into one, unticking every row would run the
// whole plan, which is the precise opposite of what the person just did.
func TestAnEmptySelectionDoesNothing(t *testing.T) {
	h := newHarness(t)
	write(t, h.left, "a.txt", "hello")

	resp := h.post(t, "/api/jobs/photos/run", `{"only":[]}`)
	resp.Body.Close()
	waitForRun(t, h, 1)

	if _, err := os.Stat(filepath.Join(h.right, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("unticking everything ran the whole plan")
	}
}

// TestNoSelectionRunsEverything is the other half of that pair.
func TestNoSelectionRunsEverything(t *testing.T) {
	h := newHarness(t)
	write(t, h.left, "a.txt", "hello")
	write(t, h.left, "b.txt", "world")

	resp := h.post(t, "/api/jobs/photos/run", ``)
	resp.Body.Close()
	waitForRun(t, h, 1)

	for _, name := range []string{"a.txt", "b.txt"} {
		if _, err := os.Stat(filepath.Join(h.right, name)); err != nil {
			t.Errorf("%s did not cross: %v", name, err)
		}
	}
}

// TestJobListReportsLastSuccess pins the column that matters. "When did this
// last run" is the easy question; "when did it last work" is the useful one.
func TestJobListReportsLastSuccess(t *testing.T) {
	h := newHarness(t)
	var before []struct {
		Name        string
		LastSuccess *string
	}
	h.get(t, "/api/jobs", &before)
	if len(before) != 1 || before[0].LastSuccess != nil {
		t.Fatalf("a job that never ran reports a success: %+v", before)
	}

	write(t, h.left, "a.txt", "hello")
	resp := h.post(t, "/api/jobs/photos/run", ``)
	resp.Body.Close()
	waitForRun(t, h, 1)

	var after []struct {
		Name        string
		LastSuccess *string
	}
	h.get(t, "/api/jobs", &after)
	if after[0].LastSuccess == nil {
		t.Fatal("a successful run left the job looking like it never worked")
	}
}

// TestAnUnknownJobIsRefused keeps a typo from looking like an empty plan.
func TestAnUnknownJobIsRefused(t *testing.T) {
	h := newHarness(t)
	resp, err := h.srv.Client().Get(h.srv.URL + "/api/jobs/nosuchjob/plan")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %s, want a refusal", resp.Status)
	}
	var body struct{ Error string }
	json.NewDecoder(resp.Body).Decode(&body)
	if !strings.Contains(body.Error, "nosuchjob") {
		t.Errorf("the error does not name the job that was asked for: %q", body.Error)
	}
}

// waitForRun blocks until the history holds the expected number of runs, so the
// tests do not race the goroutine the run request starts.
func waitForRun(t *testing.T, h *harness, want int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var runs []history.Run
		h.get(t, "/api/history", &runs)
		if len(runs) >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no run was recorded within ten seconds")
}

func (h *harness) put(t *testing.T, path, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, h.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("PUT %s: %v", path, err)
	}
	defer resp.Body.Close()
	var buf strings.Builder
	io.Copy(&buf, resp.Body)
	return resp, buf.String()
}

// TestEditingAJobSurvivesAReload is the point of the editor: a change made in a
// browser has to be the change the daemon is running, not a file somebody has
// to restart something to pick up.
func TestEditingAJobSurvivesAReload(t *testing.T) {
	h := newHarness(t)

	var before struct{ Jobs []map[string]any }
	h.get(t, "/api/config", &before)
	if len(before.Jobs) != 1 {
		t.Fatalf("expected the one configured job, got %+v", before.Jobs)
	}

	edited := before.Jobs[0]
	edited["schedule"] = "0 4 * * *"
	body, _ := json.Marshal(map[string]any{"jobs": []map[string]any{edited}})

	resp, _ := h.put(t, "/api/config", string(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the edit was refused: %s", resp.Status)
	}

	var after []struct {
		Name     string
		Schedule string
	}
	h.get(t, "/api/jobs", &after)
	if len(after) != 1 || after[0].Schedule != "0 4 * * *" {
		t.Fatalf("the running configuration did not pick up the edit: %+v", after)
	}
}

// TestARefusedEditLeavesTheFileAlone is why the new content is written beside
// the real file and only moved into place once it has been through the same
// validator a hand-written file goes through.
//
// The failure this prevents is the worst kind: an editor that half-writes a
// configuration leaves a daemon that will not start, and the person who has to
// fix it is looking at a file they did not type.
func TestARefusedEditLeavesTheFileAlone(t *testing.T) {
	h := newHarness(t)

	var before struct{ Jobs []map[string]any }
	h.get(t, "/api/config", &before)

	broken := map[string]any{
		"name": "broken", "left": "/a", "right": "/b", "state": "b.db",
		"schedule": "every second tuesday",
	}
	body, _ := json.Marshal(map[string]any{"jobs": []map[string]any{broken}})

	resp, text := h.put(t, "/api/config", string(body))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unparseable schedule was accepted: %s", resp.Status)
	}
	if !strings.Contains(text, "schedule") {
		t.Errorf("the refusal does not say what was wrong: %s", text)
	}

	var after struct{ Jobs []map[string]any }
	h.get(t, "/api/config", &after)
	if len(after.Jobs) != len(before.Jobs) || after.Jobs[0]["name"] != before.Jobs[0]["name"] {
		t.Fatalf("a refused edit changed the file anyway: %+v", after.Jobs)
	}

	var jobs []struct{ Name string }
	h.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || jobs[0].Name != "photos" {
		t.Fatalf("a refused edit reached the running configuration: %+v", jobs)
	}
}

// TestTheEditorUsesTheSameValidator checks that a rule the file already has is
// enforced through the editor too, in the same words. Two validators eventually
// disagree, and the disagreement shows up as an editor accepting something the
// daemon then refuses to start with.
func TestTheEditorUsesTheSameValidator(t *testing.T) {
	h := newHarness(t)
	twins := []map[string]any{
		{"name": "same", "left": "/a", "right": "/b", "state": "one.db"},
		{"name": "same", "left": "/c", "right": "/d", "state": "two.db"},
	}
	body, _ := json.Marshal(map[string]any{"jobs": twins})

	resp, text := h.put(t, "/api/config", string(body))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("two jobs with one name were accepted: %s", resp.Status)
	}
	if !strings.Contains(text, "both called") {
		t.Errorf("the message is not the validator's own: %s", text)
	}
}

// TestAnUnknownFieldIsRefusedThroughTheEditor keeps the editor from being a way
// around the check that catches a misspelled setting. JSON ignores a field it
// does not recognise, so "excludes" instead of "exclude" would leave the filter
// empty and sync exactly the files somebody thought they had excluded.
func TestAnUnknownFieldIsRefusedThroughTheEditor(t *testing.T) {
	h := newHarness(t)
	body, _ := json.Marshal(map[string]any{"jobs": []map[string]any{
		{"name": "typo", "left": "/a", "right": "/b", "state": "t.db", "excludes": []string{"*.tmp"}},
	}})

	resp, text := h.put(t, "/api/config", string(body))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a misspelled field was accepted: %s", resp.Status)
	}
	if !strings.Contains(text, "excludes") {
		t.Errorf("the message does not name the field: %s", text)
	}
}
