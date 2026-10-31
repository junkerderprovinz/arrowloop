//go:build windows

package apply

import (
	"os"

	"github.com/rclone/rclone/fs"
)

// unlockForReplace takes the read-only attribute off a local file a copy is
// about to replace. rclone writes beside the file and renames over it, and
// Windows refuses to rename over a read-only file, which is how Git leaves
// every object and commit graph it writes.
func unlockForReplace(f fs.Fs, remote string) error {
	p, ok := localPath(f, remote)
	if !ok {
		return nil
	}
	info, err := os.Lstat(p)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o200 != 0 {
		return nil
	}
	return os.Chmod(p, info.Mode().Perm()|0o200)
}
