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
	"testing/fstest"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/web"
	webui "github.com/junkerderprovinz/arrowloop/web"
)

type harness struct {
	srv   *httptest.Server
	left  string
	right string

	// dir is the sandbox the configuration lives in.
	dir string

	// configPath lets a test read the file back rather than trust the
	// response about it.
	configPath string

	// history and runner let a test stand a second server on the same engine.
	history *history.DB
	runner  *daemon.Runner
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

	runner := daemon.New(cfg, hist, nil, nil)
	s := &web.Server{History: hist, Runner: runner}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return &harness{srv: srv, left: left, right: right, dir: dir, configPath: cfgPath, history: hist, runner: runner}
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

func TestPreviewChangesNothing(t *testing.T) {
	h := newHarness(t)
	write(t, h.left, "a.txt", "hello")

	var view struct {
		Actions []struct {
			Path, Kind, From, To string
			Reason               struct{ Code, Text string }
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
	if got.Reason.Text == "" {
		t.Error("a proposed change with no reason is not something anybody can decide on")
	}
	// The code is what the interface translates.
	if got.Reason.Code == "" {
		t.Error("the reason carries no code, so nothing can translate it")
	}
	if _, err := os.Stat(filepath.Join(h.right, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("asking for a preview moved a file")
	}
}

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

// An absent list means everything and an empty list means nothing, or
// unticking every row would run the whole plan.
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

// A typo must not look like an empty plan.
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

// A change made in the browser has to reach the running daemon without a
// restart.
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

// A half-written configuration would leave a daemon that will not start.
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

// The editor enforces the file's rules in the same words, since a second
// validator would eventually disagree with the daemon's.
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

// "excludes" for "exclude" would otherwise leave the filter silently empty.
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

// A plain go build runs the engine and the API with no interface to draw.
func TestABinaryWithoutTheInterfaceSaysSo(t *testing.T) {
	h := newHarness(t)

	// What //go:embed produces from a dist directory nobody has built into.
	empty := fstest.MapFS{".gitkeep": &fstest.MapFile{}}
	s := &web.Server{
		History:     h.history,
		Runner:      h.runner,
		UI:          empty,
		Placeholder: []byte("<html><body>built without the interface</body></html>"),
	}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	defer resp.Body.Close()

	// Not a 404: only a build step is missing.
	if resp.StatusCode != http.StatusOK {
		t.Errorf("a binary without the interface answered %s", resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(body), "built without the interface") {
		t.Errorf("the page does not explain itself: %q", string(body))
	}
	if len(body) == 0 {
		t.Error("a blank page is indistinguishable from a broken one")
	}

	jobs, err := srv.Client().Get(srv.URL + "/api/jobs")
	if err != nil {
		t.Fatalf("GET /api/jobs: %v", err)
	}
	defer jobs.Body.Close()
	if jobs.StatusCode != http.StatusOK {
		t.Errorf("the API answered %s while the page said it was working", jobs.Status)
	}
}

// The placeholder is served when the frontend build was skipped, so it cannot
// ask for a stylesheet or script.
func TestTheShippedPlaceholderNeedsNothingElse(t *testing.T) {
	page := string(webui.Placeholder)
	if page == "" {
		t.Fatal("no placeholder is shipped at all")
	}
	for _, forbidden := range []string{"<script src", "<link rel=\"stylesheet\"", "/assets/"} {
		if strings.Contains(page, forbidden) {
			t.Errorf("the placeholder asks for %s, which is exactly what is not there", forbidden)
		}
	}
}

// newServer stands a second engine-sharing server up, for the tests that need
// a Server built differently from the harness's own.
func newServer(t *testing.T, s *web.Server) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv
}

func getJSON(t *testing.T, srv *httptest.Server, path string, into any) {
	t.Helper()
	resp, err := srv.Client().Get(srv.URL + path)
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

func putJSON(t *testing.T, srv *httptest.Server, path, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build the request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("PUT %s: %v", path, err)
	}
	defer resp.Body.Close()
	var buf strings.Builder
	io.Copy(&buf, resp.Body)
	return resp, buf.String()
}

// doJSON sends any method with an optional JSON body.
func doJSON(t *testing.T, srv *httptest.Server, method, path, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build the request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var buf strings.Builder
	io.Copy(&buf, resp.Body)
	return resp, buf.String()
}
