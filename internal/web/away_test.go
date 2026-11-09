package web_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

func TestTheJobListSaysAJobWaitsForItsDrive(t *testing.T) {
	h := newHarness(t)
	write(t, h.left, "a.txt", "a")
	if _, err := h.runner.Run(context.Background(), "photos"); err != nil {
		t.Fatalf("the first run: %v", err)
	}

	listed := func() map[string]any {
		var jobs []map[string]any
		h.get(t, "/api/jobs", &jobs)
		if len(jobs) != 1 {
			t.Fatalf("listed %d jobs, want 1", len(jobs))
		}
		return jobs[0]
	}
	if away, ok := listed()["away"]; ok {
		t.Fatalf("a job with both sides there is listed as away since %v", away)
	}

	if err := os.Rename(h.right, h.right+"-away"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := h.runner.RunAutomatically(context.Background(), "photos"); !errors.Is(err, daemon.ErrVolumeMissing) {
		t.Fatalf("a turn without the right side ended with %v", err)
	}
	if away, _ := listed()["away"].(string); away == "" {
		t.Error("the job list does not say the job waits for its drive")
	}
}
