package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// The Delete button next to how long runs are kept removes every run older
// than that at once, and the newest run of each job stays.
func TestDeletingOldRunsKeepsTheNewestOfEachJob(t *testing.T) {
	h := engineFor(t, `{"jobs":[],"historyKeep":"720h"}`)
	ctx := context.Background()
	now := time.Now()
	for _, r := range []history.Run{
		{Job: "photos", Started: now.Add(-200 * 24 * time.Hour)},
		{Job: "photos", Started: now.Add(-time.Hour)},
		{Job: "music", Started: now.Add(-300 * 24 * time.Hour)},
	} {
		r.Finished = r.Started
		if err := h.history.Record(ctx, r, nil); err != nil {
			t.Fatalf("record: %v", err)
		}
	}

	resp := h.post(t, "/api/history/prune", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("deleting old runs answered %s", resp.Status)
	}
	var got struct{ Runs int64 }
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Runs != 1 {
		t.Errorf("deleted %d runs, want the old one of photos", got.Runs)
	}
	left, err := h.history.Recent(ctx, "", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(left) != 2 {
		t.Errorf("%d runs left, want the newest of each job", len(left))
	}
}

func TestDeletingOldRunsDeletesNothingWhenEveryRunIsKept(t *testing.T) {
	h := engineFor(t, `{"jobs":[],"historyKeep":"0"}`)
	ctx := context.Background()
	old := time.Now().Add(-400 * 24 * time.Hour)
	for range 2 {
		if err := h.history.Record(ctx, history.Run{Job: "photos", Started: old, Finished: old}, nil); err != nil {
			t.Fatalf("record: %v", err)
		}
		old = old.Add(time.Hour)
	}

	resp := h.post(t, "/api/history/prune", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("deleting old runs answered %s", resp.Status)
	}
	if left, _ := h.history.Recent(ctx, "", history.ShowAll, 10); len(left) != 2 {
		t.Errorf("%d runs left of two, with every run kept", len(left))
	}
}
