//go:build !windows

package volume

import (
	"os"
	"os/user"
	"path/filepath"
)

// platformCandidates lists the mount points a marked volume could be sitting
// on: the folders in /Volumes (macOS), /media, /run/media/<user> and /mnt, and
// in the user's home, where userspace tools often mount shares.
func platformCandidates() []string {
	var out []string
	add := func(dir string) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() {
				out = append(out, filepath.Join(dir, e.Name()))
			}
		}
	}

	add("/Volumes")
	add("/media")
	add("/mnt")

	// /run/media/<user>/<label> is one level deeper.
	if entries, err := os.ReadDir("/run/media"); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				add(filepath.Join("/run/media", e.Name()))
			}
		}
	}

	if u, err := user.Current(); err == nil && u.HomeDir != "" {
		add(u.HomeDir)
	}
	return out
}
