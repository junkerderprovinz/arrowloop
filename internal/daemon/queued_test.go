package daemon

import (
	"context"
	"testing"
	"time"
)

// With one run at a time a second job waits for the first, and that wait is
// not work: it reads both sides only once its turn comes.
func TestARunWaitingForItsTurnIsQueuedAndNotWorking(t *testing.T) {
	cfg := smallConfig(t)
	r := smallRunner(t, cfg)
	startSlow(t, r)

	done := make(chan error, 1)
	go func() {
		_, err := r.Run(context.Background(), "quick")
		done <- err
	}()
	waitForClaim(t, r, "quick")

	if queued := r.Queued(); !queued["quick"] || queued["slow"] {
		t.Errorf("queued are %v, want only the waiting job", queued)
	}
	for _, w := range r.Working() {
		if w.Job == "quick" {
			t.Error("the waiting run is listed as working")
		}
	}

	r.Cancel("slow")
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the waiting run never had its turn")
	}
	if r.Queued()["quick"] {
		t.Error("the run is still queued after it ran")
	}
}
