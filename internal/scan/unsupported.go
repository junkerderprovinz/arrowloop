package scan

import (
	"os"
	"path"
	"path/filepath"

	rclonefs "github.com/rclone/rclone/fs"
)

// Unsupported is an entry that exists on a side and will never be synced: a
// symbolic link or a junction point, a socket, a named pipe or a device node.
type Unsupported struct {
	Path string
	Kind string
}

// noteUnsupported names what a local folder holds that the engine cannot
// carry.
//
// rclone's local backend drops symlinks and special files from the listing
// (Object.Storable) with only a log line, so without this they would be
// silently left out. They are only named: following a link would turn it into
// a second full copy, and rclone's .rclonelink files are of no use to other
// programs. Remote sides offer no way to look, so only local sides are
// inspected.
func (p pruned) noteUnsupported(dir string) {
	if p.local == "" {
		return
	}
	// The backend has just read this folder, so a failure here means it went
	// away since, and the next run sees what is left.
	entries, err := os.ReadDir(filepath.Join(p.local, filepath.FromSlash(dir)))
	if err != nil {
		return
	}
	for _, d := range entries {
		kind := unsupportedKind(d.Type())
		if kind == "" {
			continue
		}
		rel := path.Join(dir, d.Name())
		if IsReserved(rel) || p.exclude.Excluded(rel) {
			continue
		}
		p.mu.Lock()
		*p.unsupported = append(*p.unsupported, Unsupported{Path: rel, Kind: kind})
		p.mu.Unlock()
	}
}

// unsupportedKind names the entry type, or returns "" for something the engine
// can carry. ReadDir reports the type from an lstat, so a symlink is reported
// as a symlink rather than as whatever it points at, and with winsymlink=0 (see
// go.mod) a Windows junction is reported as one too.
func unsupportedKind(mode os.FileMode) string {
	switch {
	case mode&os.ModeSymlink != 0:
		return "symbolic link"
	case mode&os.ModeSocket != 0:
		return "socket"
	case mode&os.ModeNamedPipe != 0:
		return "named pipe"
	case mode&os.ModeCharDevice != 0:
		return "character device"
	case mode&os.ModeDevice != 0:
		return "device node"
	case mode&os.ModeIrregular != 0:
		return "irregular file"
	}
	return ""
}

// localRoot maps a filesystem back to a real directory, when there is one. On
// Windows rclone returns the root as "//?/C:/...", which Win32 does not accept
// until it is cleaned.
func localRoot(f rclonefs.Fs) (string, bool) {
	if f == nil || f.Name() != "local" {
		return "", false
	}
	return filepath.Clean(f.Root()), true
}
