package remotes

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// The address is in TEST-NET-1 (RFC 5737), reserved for documentation, so
// nothing answers it.
func TestAnUnreachableTargetGivesUpAndSaysWhy(t *testing.T) {
	const name = "arrowloop-test-unreachable"
	if err := Save(name, "webdav", map[string]string{
		"url":  "http://192.0.2.1:9999/",
		"user": "nobody",
		"pass": "nothing",
	}); err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { _ = Delete(name) })

	// Comfortably more than the deadline, so a slow machine does not fail it.
	const patience = CheckWait + 20*time.Second

	done := make(chan error, 1)
	started := time.Now()
	go func() { done <- Check(context.Background(), name) }()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("an address nobody answers reported itself reachable")
		}
		if took := time.Since(started); took > patience {
			t.Errorf("gave up after %s, which is past the %s deadline", took, CheckWait)
		}
		if !strings.Contains(err.Error(), "no answer within") {
			t.Errorf("reason = %q, want it to say the wait ran out", err)
		}
	case <-time.After(patience):
		t.Fatalf("still checking after %s: the deadline is not being applied", patience)
	}
}

func TestARealFailureKeepsItsOwnWords(t *testing.T) {
	err := checkErr(context.Background(), errors.New("didn't find section in config file"))
	if strings.Contains(err.Error(), "no answer within") {
		t.Fatalf("a non-deadline failure was reported as a timeout: %v", err)
	}
}
