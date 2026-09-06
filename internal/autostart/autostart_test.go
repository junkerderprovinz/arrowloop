package autostart

import "testing"

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
