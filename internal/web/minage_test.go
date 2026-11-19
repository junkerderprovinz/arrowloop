package web_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

const waiting = `{"jobs":[{"name":"camera","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/camera.db","quietPeriod":"0s","direction":"leftToRight","mode":"move","minAgeDays":30}]}`

func TestTheJobListSaysHowLongAJobWaits(t *testing.T) {
	h := engineFor(t, waiting)
	var jobs []struct {
		Name       string
		MinAgeDays int
	}
	h.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || jobs[0].MinAgeDays != 30 {
		t.Fatalf("the job list does not carry the minimum age: %+v", jobs)
	}
}

func TestThePreviewCountsTheFilesTooYoungToGo(t *testing.T) {
	h := engineFor(t, waiting)
	write(t, h.left, "today.jpg", "taken today")
	var view struct {
		Actions []struct{ Path string }
		Skipped []struct{ Path string }
		Young   int
	}
	h.get(t, "/api/jobs/camera/plan", &view)
	if len(view.Actions) != 0 || len(view.Skipped) != 0 || view.Young != 1 {
		t.Fatalf("a photo taken today shows as %+v", view)
	}
}

func TestTheEditorRefusesAMinimumAgeOnATwoWayJob(t *testing.T) {
	h := newHarness(t)
	body, _ := json.Marshal(map[string]any{"jobs": []map[string]any{
		{"name": "both", "left": "/a", "right": "/b", "state": "b.db", "minAgeDays": 7},
	}})
	resp, text := h.put(t, "/api/config", string(body))
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(text, "one-way") {
		t.Fatalf("a two-way job with a minimum age was saved: %s %s", resp.Status, text)
	}
}
