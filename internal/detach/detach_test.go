package detach

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestItReturnsWhatTheWorkReturns(t *testing.T) {
	got, err := Until(context.Background(), func() (string, error) { return "d41d8cd9", nil })
	if got != "d41d8cd9" || err != nil {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestAStopDoesNotWaitOutWorkThatIgnoresIt(t *testing.T) {
	defer func(was time.Duration) { grace = was }(grace)
	grace = 50 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	release := make(chan struct{})
	defer close(release)
	time.AfterFunc(20*time.Millisecond, cancel)

	start := time.Now()
	_, err := Until(ctx, func() (int, error) {
		<-release
		return 1, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want the stop", err)
	}
	if waited := time.Since(start); waited > time.Second {
		t.Errorf("waited %v for work that ignores the stop", waited)
	}
}

// Work that hears the stop gets to finish, so what it says about itself, and
// what it tidies up, is not lost.
func TestWorkThatHearsTheStopIsWaitedFor(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(20*time.Millisecond, cancel)

	tidied := false
	_, err := Until(ctx, func() (int, error) {
		<-ctx.Done()
		time.Sleep(20 * time.Millisecond)
		tidied = true
		return 0, errors.New("removed the partial file")
	})
	if err == nil || err.Error() != "removed the partial file" {
		t.Errorf("got %v, want the work's own error", err)
	}
	if !tidied {
		t.Error("returned before the work had tidied up")
	}
}

func TestNothingStartsAfterTheStop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := false
	if _, err := Until(ctx, func() (int, error) { started = true; return 0, nil }); !errors.Is(err, context.Canceled) {
		t.Errorf("got %v, want the stop", err)
	}
	if started {
		t.Error("the work started although the run was already stopped")
	}
}
