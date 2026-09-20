// Package autostart registers the program to start with the user's session.
//
// Every entry is per user (HKCU, the user's autostart directory, a LaunchAgent
// in the user's Library): a sync tool has to run as the person whose files it
// syncs, with their mapped drives and home directory. The state is read back
// from the system rather than stored, so the toggle stays right when somebody
// removes the entry with the operating system's own tools.
package autostart

import "os"

// name is the entry's name on every platform. Writing and looking up under the
// same name keeps repeated toggles from piling up duplicates.
const name = "ArrowLoop"

// Supported reports whether this platform has an implementation, so the
// interface can leave out a switch that would do nothing.
func Supported() bool { return supported }

// Enabled reports whether the program is registered to start with the session.
// An unsupported platform answers false without an error.
func Enabled() (bool, error) { return enabled() }

// Set registers or unregisters the running executable. The path comes from
// os.Executable because a caller-supplied path goes stale. Unregistering a
// missing entry is not an error.
func Set(on bool) error {
	if !supported {
		return errUnsupported
	}
	if !on {
		return disable()
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return enable(exe)
}

// Refresh re-points an existing entry at the running executable, so an entry
// written for a copy that has since moved does not fail silently at the next
// reboot. It leaves a switched-off entry alone and writes nothing when the
// entry already points here.
func Refresh() error {
	if !supported {
		return nil
	}
	on, err := enabled()
	if err != nil || !on {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	same, err := pointsAt(exe)
	if err != nil || same {
		return err
	}
	return enable(exe)
}
