//go:build !windows

package volume

import (
	"os"
	"os/user"
	"path/filepath"
)

// platformCandidates lists the mount points a marked volume could be sitting on.
//
// These are the places the three desktop conventions put a removable disk or a
// mounted share: /Volumes on macOS, /media and /run/media on Linux (the latter
// nested one level under the user's name), and /mnt for anything mounted by
// hand. The user's home is included as a bare root as well, because a share
// mounted with a userspace tool often lands somewhere inside it.
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

	// /run/media/<user>/<label> is the systemd convention, so the interesting
	// level is one deeper.
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
