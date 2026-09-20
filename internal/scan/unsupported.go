package scan

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	rclonefs "github.com/rclone/rclone/fs"
)

// Unsupported is an entry that exists on a side and will never be synced: a
// symbolic link, a socket, a named pipe, a device node, or on Windows a
// junction point.
type Unsupported struct {
	Path string
	Kind string
}

// FindUnsupported lists what a local side holds that the engine cannot carry.
//
// rclone's local backend drops symlinks and special files from the listing
// (Object.Storable) with only a log line, so without this they would be
// silently left out. They are only named: following a link would turn it into
// a second full copy, and rclone's .rclonelink files are of no use to other
// programs. Remote sides offer no way to look, so only local sides are
// inspected.
func FindUnsupported(ctx context.Context, f rclonefs.Fs, opt Options) ([]Unsupported, error) {
	root, ok := localRoot(f)
	if !ok {
		return nil, nil
	}

	var out []Unsupported
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			// An unreadable directory is left to the listing, which fails on
			// it with a better message, and a missing root is a new job's
			// target that does not exist yet.
			if p == root && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if IsReserved(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if opt.Exclude.Excluded(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if kind := unsupportedKind(d.Type()); kind != "" {
			out = append(out, Unsupported{Path: rel, Kind: kind})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("look for unsupported entries under %s: %w", root, err)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

// unsupportedKind names the entry type, or returns "" for something the engine
// can carry. WalkDir reports the type from an lstat, so a symlink is reported
// as a symlink rather than as whatever it points at.
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
		// Windows reports a junction point this way.
		return "junction or irregular file"
	}
	return ""
}

// localRoot maps a filesystem back to a real directory, when there is one. On
// Windows rclone returns the root as "//?/C:/...", which Win32 and
// filepath.Rel do not accept until it is cleaned.
func localRoot(f rclonefs.Fs) (string, bool) {
	if f == nil || f.Name() != "local" {
		return "", false
	}
	return filepath.Clean(f.Root()), true
}
