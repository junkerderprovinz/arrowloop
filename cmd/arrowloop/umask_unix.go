//go:build !windows

package main

import (
	"fmt"
	"os"
	"strconv"
	"syscall"
)

/*
applyUmask sets the file-creation mask for everything this process writes.

THE SAME DEFECT AS THE BROWSE PANEL'S MKDIR, one layer down and with a much
wider blast radius. A container writing into an Unraid share runs as root with
the usual umask of 022, so every file a run copies lands as 0644 root:root and
every folder as 0755 root:root - readable by the person who owns the share, and
not writable. The folder case is the one that got reported, because a folder
you cannot write to announces itself immediately; the copied FILES are the same
problem arriving quietly, and the first time anybody notices is when they try
to edit one.

It cannot be fixed the way mkdir was. The copying is rclone's, so there is no
moment between "file created" and "file written" for this program to step into,
and chasing every written path afterwards would be a second traversal of the
tree to repair what should not have been wrong.

The umask is the one lever that covers all of it, because it applies to every
create the process makes, through rclone or otherwise. Empty means "do not
touch it", which is what a desktop install wants: there the process IS the
user, the files already have the right owner, and a 000 mask would hand every
synchronised file to everyone on the machine for no reason. The container image
sets 000, which matches the share it writes into.
*/
func applyUmask(spec string) error {
	if spec == "" {
		return nil
	}
	mask, err := strconv.ParseUint(spec, 8, 32)
	if err != nil || mask > 0o777 {
		return fmt.Errorf("ARROWLOOP_UMASK=%q is not an octal mask such as 000 or 022", spec)
	}
	syscall.Umask(int(mask))
	return nil
}

/** The mask this process was asked for, or "" when nobody asked. */
func umaskSetting() string { return os.Getenv("ARROWLOOP_UMASK") }
