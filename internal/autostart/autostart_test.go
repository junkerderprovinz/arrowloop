package autostart

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRegisterAndRemove runs against the real system so it proves Enabled reads
// the system rather than a stored flag. The starting state is restored.
func TestRegisterAndRemove(t *testing.T) {
	if !Supported() {
		t.Skip("no implementation on this system")
	}

	was, err := Enabled()
	if err != nil {
		t.Fatalf("read the starting state: %v", err)
	}
	t.Cleanup(func() {
		if err := Set(was); err != nil {
			t.Errorf("restore the starting state: %v", err)
		}
	})

	if err := Set(true); err != nil {
		t.Fatalf("register: %v", err)
	}
	on, err := Enabled()
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !on {
		t.Fatal("registered, and the system says it is not registered")
	}

	if err := Set(false); err != nil {
		t.Fatalf("unregister: %v", err)
	}
	off, err := Enabled()
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if off {
		t.Fatal("unregistered, and the system still says it is registered")
	}

	if err := Set(false); err != nil {
		t.Fatalf("unregister a second time: %v", err)
	}
}

func TestUnsupportedAnswersFalse(t *testing.T) {
	if Supported() {
		t.Skip("this system has an implementation")
	}
	on, err := Enabled()
	if err != nil {
		t.Fatalf("an unsupported system should answer, not fail: %v", err)
	}
	if on {
		t.Fatal("an unsupported system cannot have autostart on")
	}
	if err := Set(true); err == nil {
		t.Fatal("switching it on should say it cannot be done here")
	}
}

func TestRefreshFollowsTheExecutable(t *testing.T) {
	if !Supported() {
		t.Skip("no implementation on this system")
	}

	was, err := Enabled()
	if err != nil {
		t.Fatalf("read the starting state: %v", err)
	}
	t.Cleanup(func() {
		if err := Set(was); err != nil {
			t.Errorf("restore the starting state: %v", err)
		}
	})

	if err := enable(filepath.Join(t.TempDir(), "somewhere-else", "ArrowLoop")); err != nil {
		t.Fatalf("write the stale entry: %v", err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("executable: %v", err)
	}
	if stale, err := pointsAt(exe); err != nil || stale {
		t.Fatalf("the stale entry already points here (%v, %v)", stale, err)
	}

	if err := Refresh(); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	now, err := pointsAt(exe)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !now {
		t.Fatal("the entry still points at the old path after a refresh")
	}
}

func TestRefreshLeavesAnAbsentEntryAlone(t *testing.T) {
	if !Supported() {
		t.Skip("no implementation on this system")
	}

	was, err := Enabled()
	if err != nil {
		t.Fatalf("read the starting state: %v", err)
	}
	t.Cleanup(func() {
		if err := Set(was); err != nil {
			t.Errorf("restore the starting state: %v", err)
		}
	})

	if err := Set(false); err != nil {
		t.Fatalf("switch off: %v", err)
	}
	if err := Refresh(); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	on, err := Enabled()
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if on {
		t.Fatal("a refresh switched autostart back on for somebody who turned it off")
	}
}
