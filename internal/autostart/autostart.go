// Package autostart registers the program to start with the user's session.
//
// Every implementation here is USER level: a registry value under HKCU, a file
// in the user's own autostart directory, a LaunchAgent in the user's own
// Library. None of them asks for administrative rights, and none of them
// affects anybody else on the machine. That is deliberate rather than merely
// convenient: a sync tool starts as the person whose files it syncs, so a
// machine-wide entry would run it as the wrong user with the wrong mapped
// drives and the wrong home directory.
//
// The state lives in the system, not in a settings file, and Enabled reads it
// back from there. A stored boolean would go on claiming autostart was on after
// somebody removed the entry with the operating system's own tools, and a
// toggle that disagrees with the thing it controls is worse than no toggle.
package autostart

import "os"

// name is what the entry is called wherever the platform wants a name. One
// constant, because an entry written under one name and looked for under
// another is an entry that accumulates duplicates every time it is switched on.
const name = "ArrowLoop"

// Supported reports whether this platform has an implementation at all.
//
// The interface asks so it can leave the switch out rather than draw one that
// does nothing. A setting that cannot act is worse than a missing one, because
// somebody will set it and expect a result.
func Supported() bool { return supported }

// Enabled reports whether the program is currently registered to start with the
// session, read from the system itself.
//
// A platform without an implementation answers false with no error: "this
// cannot be on here" is an answer, not a failure.
func Enabled() (bool, error) { return enabled() }

// Set registers or unregisters the RUNNING executable.
//
// The path comes from os.Executable rather than from an argument, because the
// only correct answer is "the thing that is running": a caller passing a path
// would eventually pass a stale one, and an autostart entry pointing at a
// binary that has moved is the failure that shows up months later at a reboot.
//
// Turning it off never fails for a missing entry. Removing something that is
// not there is the state the caller asked for.
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

// Refresh re-points an existing entry at the running executable.
//
// An entry records a PATH, and a path is a promise about where a file will be
// months from now. Somebody who switched autostart on for a portable copy on
// their desktop and later installed the program properly, or simply moved the
// file, has an entry pointing at nothing: it fails at a reboot, silently, which
// is the worst place and the worst way.
//
// Called at startup, so the entry follows the program rather than the other way
// round. It does nothing when autostart is off, because rewriting an entry
// somebody removed would be switching a setting back on for them.
//
// It compares before writing. An unchanged entry is left completely alone, so a
// machine where nothing moved sees no file touched and no registry value
// rewritten on every single sign-in.
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
