//go:build !windows

package apply

import "github.com/rclone/rclone/fs"

// unlockForReplace does nothing: a rename replaces a read-only file whenever
// its directory is writable.
func unlockForReplace(fs.Fs, string) error { return nil }
