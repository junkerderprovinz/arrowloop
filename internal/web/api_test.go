package web_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/reeveroll/internal/daemon"
	"github.com/junkerderprovinz/reeveroll/internal/history"
	"github.com/junkerderprovinz/reeveroll/internal/job"
	"github.com/junkerderprovinz/reeveroll/internal/web"
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
	cfgPath := filepath.Join(dir, "reeveroll.json")
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

	s := &web.Server{Config: cfg, History: hist, Runner: daemon.New(cfg, hist, nil, nil)}
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
