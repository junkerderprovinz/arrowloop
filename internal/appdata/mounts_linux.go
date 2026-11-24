package appdata

import (
	"io/fs"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

const nonBlock = syscall.O_NONBLOCK

// None of these has a name in x/sys/unix.
const (
	configfsMagic   = 0x62656570
	fusectlMagic    = 0x65735543
	functionfsMagic = 0xa647361
	mqueueMagic     = 0x19800202
)

// madeUpFS is the file systems the kernel makes up as they are read. Their
// trees are endless or change under a scan, their files claim no size, and
// some of them act when opened, such as the endpoints of a USB gadget that
// adbd holds.
var madeUpFS = map[int64]bool{
	unix.PROC_SUPER_MAGIC:     true,
	unix.SYSFS_MAGIC:          true,
	unix.DEVPTS_SUPER_MAGIC:   true,
	unix.CGROUP_SUPER_MAGIC:   true,
	unix.CGROUP2_SUPER_MAGIC:  true,
	unix.DEBUGFS_MAGIC:        true,
	unix.TRACEFS_MAGIC:        true,
	unix.SECURITYFS_MAGIC:     true,
	unix.SELINUX_MAGIC:        true,
	unix.PSTOREFS_MAGIC:       true,
	unix.BPF_FS_MAGIC:         true,
	unix.BINDERFS_SUPER_MAGIC: true,
	unix.EFIVARFS_MAGIC:       true,
	unix.NSFS_MAGIC:           true,
	configfsMagic:             true,
	fusectlMagic:              true,
	functionfsMagic:           true,
	mqueueMagic:               true,
}

// madeUp reports whether p lies on one of those file systems or below one,
// since a real file system can be mounted inside them, as binfmt_misc is in
// /proc.
func madeUp(p string) bool {
	for {
		var st unix.Statfs_t
		if unix.Statfs(p, &st) == nil && madeUpFS[int64(st.Type)] {
			return true
		}
		up := filepath.Dir(p)
		if up == p {
			return false
		}
		p = up
	}
}

// mountPoint reports whether entry, listed in the folder dir, has another
// file system mounted on it.
func mountPoint(dir, entry fs.FileInfo) bool {
	a, okA := dir.Sys().(*syscall.Stat_t)
	b, okB := entry.Sys().(*syscall.Stat_t)
	return okA && okB && a.Dev != b.Dev
}
