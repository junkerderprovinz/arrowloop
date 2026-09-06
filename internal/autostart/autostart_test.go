package autostart

import (
	"os"
	"path/filepath"
	"testing"
)

// Registering, reading back and unregistering, against the real system this
// test runs on. It is the only way to prove Enabled reads the SYSTEM rather
// than a remembered boolean, which is the property the settings toggle relies
// on to stay honest when somebody removes the entry with their own tools.
//
// It leaves nothing behind: the starting state is restored whatever happens,
// because a test that switches somebody's real autostart on and forgets to
// switch it off is a test that changes the machine it ran on.
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

	// Twice, because the caller is a settings toggle and somebody will press it
	// twice. Removing something that is not there is the state they asked for,
	// not an error.
	if err := Set(false); err != nil {
		t.Fatalf("unregister a second time: %v", err)
	}
}

// An unsupported system answers rather than failing to build or panicking.
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

// TestRefreshFollowsTheExecutable covers the silent failure this whole entry is
// prone to: it records a PATH, and a path is a promise about where a file will
// still be months from now.
//
// Somebody switches autostart on for a portable copy on their desktop, later
// installs the program properly or simply moves the file, and the entry now
// points at nothing. It fails at a reboot, quietly, which is the worst place and
// the worst way to find out.
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

	// An entry left behind by a copy that used to live somewhere else.
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

// Refresh must not switch a setting back on for somebody who turned it off.
// Rewriting an absent entry would do exactly that, and it would do it at every
// start, so the switch could never be made to stay off.
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
