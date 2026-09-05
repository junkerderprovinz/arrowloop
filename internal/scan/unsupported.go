package scan

import (
	"context"
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
// This exists because rclone does not tell a library caller. Its local backend
// decides in Object.Storable(): a symlink or a special file is dropped from the
// listing after a single log line, so from the outside it is indistinguishable
// from a file that is not there. Silently omitting a file is the worst possible
// answer for a sync tool, because the user believes the folder is covered.
//
// Nothing is done about these entries beyond naming them. Following a symlink
// would copy the target and turn one link into a full second copy on the other
// side; storing it as rclone's `.rclonelink` text file would produce something
// no other program can use and would break the moment the target path means
// something different over there. Neither is obviously right, so the engine
// reports and leaves them, which at least lets the user decide.
//
// Only local sides are inspected, because only a local side has a filesystem
// underneath that can be asked. Over SFTP or S3 the same entries are equally
// invisible and there is no second channel to look through.
func FindUnsupported(ctx context.Context, f rclonefs.Fs, opt Options) ([]Unsupported, error) {
	root, ok := localRoot(f)
	if !ok {
		return nil, nil
	}

	var out []Unsupported
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			// A directory that cannot be read is a real problem, but it is not
			// this function's problem: the listing will fail on it too, and
			// with a better message.
			if p == root {
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
		// Windows reports a junction point this way, and rclone's local backend
		// treats it as a symlink for exactly this reason.
		return "junction or irregular file"
	}
	return ""
}

// localRoot maps a filesystem back to a real directory, when there is one.
//
// The Clean is not cosmetic. On Windows rclone's local backend makes every root
// an extended-length path so that names over 260 characters work at all, and
// then Root() hands it back with forward slashes, as "//?/C:/...". Win32 does
// not accept that spelling, and filepath.Rel would compare it against the
// backslash form that WalkDir produces and get the wrong answer. Clean turns it
// back into the form both of them want.
func localRoot(f rclonefs.Fs) (string, bool) {
	if f == nil || f.Name() != "local" {
		return "", false
	}
	return filepath.Clean(f.Root()), true
}
