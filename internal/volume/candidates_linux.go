//go:build linux

package volume

import (
	"os"
	"os/user"
	"path/filepath"
)

// platformCandidates lists what is mounted where a removable disk or a share
// turns up. Only real mount points count, so neither a container's own files
// nor the plain folders of a home are offered as drives.
func platformCandidates() []string {
	f, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		return nil
	}
	defer f.Close()

	var home string
	if u, err := user.Current(); err == nil {
		home = u.HomeDir
	}
	return offered(mountPoints(f), home)
}

// Name returns the name a mount point goes by, which is its folder:
// /media/usb/Backup is called Backup.
func Name(mount string) string {
	return filepath.Base(mount)
}
