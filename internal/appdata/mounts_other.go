//go:build !linux

package appdata

import "io/fs"

const nonBlock = 0

// madeUp and mountPoint find the kernel's own file systems, which only Linux
// mounts among the files.
func madeUp(p string) bool { return false }

func mountPoint(dir, entry fs.FileInfo) bool { return false }
