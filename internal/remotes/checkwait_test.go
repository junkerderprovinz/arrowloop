package remotes

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// A check against an address nothing answers must END, and say so.
//
// Found on a phone that had moved to mobile data and could no longer route to a
// target on a private address: the button said "checking" for more than four
// minutes. rclone has no deadline of its own here, so the wait was whatever the
// operating system allows a TCP connect to an unreachable address - and a
// control that never comes back is indistinguishable from an app that is stuck.
//
// The address is in TEST-NET-1 (RFC 5737), which exists to be unroutable: it is
// reserved for documentation, so no machine anywhere answers it and the test
// cannot accidentally reach somebody's server.
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

	// Comfortably more than the deadline, so a test that fails here failed
	// because nothing gave up rather than because the machine was slow.
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
		// The reason has to read as "it did not answer" rather than as an
		// internal fault, because the person reading it is deciding whether they
		// typed the address wrong or their network simply cannot reach it.
		if !strings.Contains(err.Error(), "no answer within") {
			t.Errorf("reason = %q, want it to say the wait ran out", err)
		}
	case <-time.After(patience):
		t.Fatalf("still checking after %s: the deadline is not being applied", patience)
	}
}

// The deadline must not swallow a REAL error. A target whose settings are
// nonsense should say so in rclone's own words, not blame the clock.
func TestARealFailureKeepsItsOwnWords(t *testing.T) {
	err := checkErr(context.Background(), errors.New("didn't find section in config file"))
	if strings.Contains(err.Error(), "no answer within") {
		t.Fatalf("a non-deadline failure was reported as a timeout: %v", err)
	}
}
