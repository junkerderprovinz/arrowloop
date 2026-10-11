package job

import (
	"os"
	"path/filepath"
	"strings"
)

// localPath reports whether a side is a folder on this machine rather than a
// target, a drive identity or a relative spelling nobody can place.
func localPath(p string) bool {
	return filepath.IsAbs(p) || strings.HasPrefix(p, `\\`)
}

// resolved turns a local path into the one spelling the disk agrees on: made
// absolute, cleaned and with symlinks followed. A path that cannot be resolved,
// because it does not exist yet, keeps its cleaned spelling.
func resolved(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = filepath.Clean(p)
	}
	if out, err := filepath.EvalSymlinks(abs); err == nil {
		return out
	}
	return abs
}

// SamePlace reports whether two local paths are one place on disk, reached
// through a symlink or a second spelling as well as the same one. Paths that
// both exist are compared by the file system's own identity, which also
// knows whether the volume tells case apart.
func SamePlace(a, b string) bool {
	if a == "" || b == "" || !localPath(a) || !localPath(b) {
		return false
	}
	ra, rb := resolved(a), resolved(b)
	if ra == rb {
		return true
	}
	ia, errA := os.Stat(ra)
	ib, errB := os.Stat(rb)
	return errA == nil && errB == nil && os.SameFile(ia, ib)
}
