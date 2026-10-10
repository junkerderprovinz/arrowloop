package appdata

import (
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

const noFollow = syscall.O_NOFOLLOW

const selinuxLabel = "security.selinux"

// handOver gives p the owner, group and SELinux label of its app folder, the
// way Android sets up what the app creates itself. Without it a file written
// as root stays root's, and the app gets "permission denied" on its own data.
func (h *handler) handOver(p, app string, dir bool) error {
	if !h.adopt {
		return nil
	}
	info, err := os.Stat(app)
	if err != nil {
		return err
	}
	st := info.Sys().(*syscall.Stat_t)
	if err := os.Lchown(p, int(st.Uid), int(st.Gid)); err != nil {
		return err
	}
	// The group (ext_data_rw) is inherited through the setgid bit on the app
	// folder, so new folders need it as well.
	mode := os.FileMode(0o660)
	if dir {
		mode = 0o770 | os.ModeSetgid
	}
	if err := os.Chmod(p, mode); err != nil {
		return err
	}
	label := make([]byte, 256)
	n, err := unix.Lgetxattr(app, selinuxLabel, label)
	if err != nil {
		// No label to copy, which is the case off Android.
		return nil
	}
	return unix.Lsetxattr(p, selinuxLabel, label[:n], 0)
}
