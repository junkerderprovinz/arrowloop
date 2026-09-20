package web_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

func TestARunsOwnWorkIsReachable(t *testing.T) {
	h := newHarness(t)
	now := time.Now()
	if err := h.history.Record(t.Context(), history.Run{Job: "photos", Started: now, Finished: now},
		[]history.Entry{
			{Kind: "copy", Side: "right", Path: "a.jpg"},
			{Kind: "conflict", Path: "notes.txt", Note: "keep both"},
		}); err != nil {
		t.Fatalf("record: %v", err)
	}
	runs, err := h.history.Recent(t.Context(), "photos", history.ShowAll, 10)
	if err != nil || len(runs) != 1 {
		t.Fatalf("recent: %v, %d runs", err, len(runs))
	}

	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})
	resp, err := srv.Client().Get(srv.URL + "/api/history/" + itoa(runs[0].ID) + "/entries")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("asking for a run's entries answered %s", resp.Status)
	}

	var got []history.Entry
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected two entries, got %d", len(got))
	}
	if got[1].Note != "keep both" {
		t.Errorf("the conflict came back without its decision: %+v", got[1])
	}
}

func TestAnEmptyRunIsAListAndNotNull(t *testing.T) {
	h := newHarness(t)
	now := time.Now()
	if err := h.history.Record(t.Context(), history.Run{Job: "photos", Started: now, Finished: now}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	runs, _ := h.history.Recent(t.Context(), "photos", history.ShowAll, 1)

	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})
	resp, err := srv.Client().Get(srv.URL + "/api/history/" + itoa(runs[0].ID) + "/entries")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(raw) != "[]" {
		t.Errorf("a run that did nothing came back as %s rather than an empty list", raw)
	}
}

func TestSomethingThatIsNotARunIdIsRefused(t *testing.T) {
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	resp, err := srv.Client().Get(srv.URL + "/api/history/not-a-number/entries")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a run id of \"not-a-number\" answered %s rather than refusing it", resp.Status)
	}
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
