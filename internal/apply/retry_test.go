package apply

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rclone/rclone/fs/fserrors"
)

// A transfer that failed because of the weather gets another go.
//
// One dropped connection currently ended the whole run: a file failed, the run
// reported a failure, and the next scheduled turn started the entire comparison
// again. That is the most common way a nightly job "breaks" and it is not a
// break at all.
//
// What is guarded here is the JUDGEMENT as much as the loop. Retrying a
// permission error or a full disk turns one clear failure into three slow ones
// and tells the person nothing new, so the decision is rclone's own and this
// pins that it stays that way.

func TestATransientFailureIsTriedAgain(t *testing.T) {
	tries := 0
	err := retrying(context.Background(), func() error {
		tries++
		if tries < 3 {
			// What a dropped connection looks like to rclone.
			return fserrors.RetryError(errors.New("connection reset by peer"))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("gave up on something that would have worked: %v", err)
	}
	if tries != 3 {
		t.Errorf("tried %d times, expected 3", tries)
	}
}

func TestAPermanentFailureIsNotTriedAgain(t *testing.T) {
	tries := 0
	err := retrying(context.Background(), func() error {
		tries++
		return errors.New("permission denied")
	})
	if err == nil {
		t.Fatal("reported success on a failure")
	}
	if tries != 1 {
		t.Errorf("tried %d times; a permission error is not going to fix itself", tries)
	}
}

// TestASucceedingTransferIsNotDelayed.
//
// The ordinary case is the one that must cost nothing: no wait, no second call,
// no wrapper visible in the result.
func TestASucceedingTransferIsNotDelayed(t *testing.T) {
	tries := 0
	started := time.Now()
	if err := retrying(context.Background(), func() error { tries++; return nil }); err != nil {
		t.Fatalf("a working transfer reported %v", err)
	}
	if tries != 1 {
		t.Errorf("called the transfer %d times when it worked the first time", tries)
	}
	if time.Since(started) > time.Second {
		t.Error("waited before returning a success")
	}
}

// TestACancelledRunStopsDuringTheWait.
//
// The gap between attempts is where a cancelled run would otherwise sit for
// seconds doing nothing. Stopping has to reach INTO the wait, not queue behind
// it, or the stop button appears not to work.
func TestACancelledRunStopsDuringTheWait(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		stop()
	}()

	started := time.Now()
	err := retrying(ctx, func() error {
		return fserrors.RetryError(errors.New("connection reset by peer"))
	})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("waited out the pause and returned %v instead of the cancellation", err)
	}
	if waited := time.Since(started); waited > 2*time.Second {
		t.Errorf("took %v to notice the cancellation", waited)
	}
}
