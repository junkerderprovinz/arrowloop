package web_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type findingList struct {
	Open, Closed []struct {
		ID, Job, Kind, Severity, Outcome string
		Held                             bool
		Count, Known                     int
		Paths                            []string
	}
}

// heldJob leaves the photos job held by the mass-delete brake: forty files
// both sides agreed on, of which the left has since lost thirty.
func heldJob(t *testing.T, h *harness) {
	t.Helper()
	for i := range 40 {
		write(t, h.left, fmt.Sprintf("bild-%02d.jpg", i), "first")
	}
	if _, err := h.runner.Run(context.Background(), "photos"); err != nil {
		t.Fatalf("first run: %v", err)
	}
	for i := range 30 {
		if err := os.Remove(filepath.Join(h.left, fmt.Sprintf("bild-%02d.jpg", i))); err != nil {
			t.Fatalf("remove: %v", err)
		}
	}
	// The refusal is the point, so the run's own answer is not looked at.
	_, _ = h.runner.Run(context.Background(), "photos")
}

func TestTheFindingListIsNeverNull(t *testing.T) {
	h := newHarness(t)
	var raw map[string]any
	h.get(t, "/api/anomalies", &raw)
	for _, key := range []string{"open", "closed"} {
		if list, ok := raw[key].([]any); !ok || len(list) != 0 {
			t.Errorf("%q is %v, want an empty list a screen can map over", key, raw[key])
		}
	}
}

func TestAHeldJobIsListedAndAnsweredOverTheAPI(t *testing.T) {
	h := newHarness(t)
	heldJob(t, h)

	var list findingList
	h.get(t, "/api/anomalies", &list)
	if len(list.Open) != 1 {
		t.Fatalf("expected one open finding, got %+v", list)
	}
	f := list.Open[0]
	if f.Job != "photos" || f.Kind != "delete" || !f.Held || f.Count != 30 || f.Known != 40 || len(f.Paths) != 30 {
		t.Fatalf("the finding reads wrong: %+v", f)
	}

	answer := func(how string) int {
		resp := h.post(t, "/api/anomalies/"+f.ID+"/"+how, "")
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if got := answer("acknowledge"); got != http.StatusBadRequest {
		t.Errorf("acknowledging a held job answered %d, want it refused", got)
	}
	if got := answer("sideways"); got != http.StatusNotFound {
		t.Errorf("an answer that does not exist got %d, want 404", got)
	}
	if got := answer("back"); got != http.StatusAccepted {
		t.Fatalf("taking back answered %d, want it started", got)
	}

	// The answer runs on its own, so the list is asked until it has landed.
	deadline := time.Now().Add(20 * time.Second)
	for {
		h.get(t, "/api/anomalies", &list)
		if len(list.Open) == 0 && len(list.Closed) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the finding never closed: %+v", list)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if got := list.Closed[0].Outcome; got != "takenBack" {
		t.Errorf("the finding closed as %q, want it taken back", got)
	}
	if left, _ := filepath.Glob(filepath.Join(h.left, "bild-*.jpg")); len(left) != 40 {
		t.Errorf("the left side holds %d files after taking back, want all 40", len(left))
	}
	if got := answer("run"); got != http.StatusNotFound {
		t.Errorf("answering a closed finding got %d, want 404", got)
	}
}

func TestEveryJobIsListedWithWhatItHasLearned(t *testing.T) {
	h := newHarness(t)
	if _, err := h.runner.Run(context.Background(), "photos"); err != nil {
		t.Fatalf("run: %v", err)
	}
	var learning []struct {
		Job   string
		Runs  int
		Usual []struct{ Figure string }
	}
	h.get(t, "/api/anomalies/learning", &learning)
	if len(learning) == 0 || learning[0].Job != "photos" || learning[0].Runs != 1 || learning[0].Usual != nil {
		t.Errorf("the learning reads %+v, want photos with one run and no range yet", learning)
	}
}
