//go:build !windows

package web

import (
	"os"
	"syscall"
)

// inheritFrom gives a freshly created directory the permissions and the owner
// of the directory it was created in. On an Unraid share that is nobody:users
// with 0777, where a container running as root would otherwise create a
// root:root 0755 folder the share's users cannot write to.
func inheritFrom(parent, made string) {
	info, err := os.Stat(parent)
	if err != nil {
		return
	}
	// Chmod, because the umask masks the mode handed to Mkdir.
	_ = os.Chmod(made, info.Mode().Perm())

	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return
	}
	// Only a privileged process may change the owner; an unprivileged one is
	// already the owner it would set.
	_ = os.Chown(made, int(st.Uid), int(st.Gid))
}
