//go:build !windows

package web

import (
	"os"
	"syscall"
)

/*
inheritFrom gives a freshly created directory the permissions and the owner of
the directory it was created in.

WHAT IT IS FOR, from a report rather than from theory. On an Unraid box the
share is `nobody:users` with mode 0777, which is what lets somebody drop a file
into it over SMB. The container writing into that share runs as root, so a
folder created through the browse panel came out `root:root` with 0755, and the
person who asked for it could open it and not write to it. jdp, with the
Windows dialog in hand: "in die test ordner kann ich keine dateien ablegen. in
den download ordner selbst schon."

Measured on the box before the fix, which is what named the cause:

	drwxrwxrwx nobody users  .           <- the share
	drwxr-xr-x root   root   testlinks   <- what this program made

Inheriting is the right rule rather than a fixed mode, because it makes the new
folder behave like the folder it sits in, which is exactly what somebody
expects and the only answer that is correct on a private disk as well as on a
world-writable share.
*/
func inheritFrom(parent, made string) {
	info, err := os.Stat(parent)
	if err != nil {
		return
	}
	// Chmod rather than trusting the mode handed to Mkdir: the process umask
	// masks that mode, and a container's default 022 is precisely what turns an
	// inherited 0777 into the 0755 that was reported.
	_ = os.Chmod(made, info.Mode().Perm())

	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return
	}
	// Best effort, and a failure here is not an error worth reporting: only a
	// privileged process may hand a directory to another owner, and a desktop
	// install is not one. There the process IS the user, so the owner is
	// already right and there is nothing to fix.
	_ = os.Chown(made, int(st.Uid), int(st.Gid))
}
