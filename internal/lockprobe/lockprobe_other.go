//go:build !windows

// Package lockprobe asks whether a local file is currently held open by another
// program. See lockprobe_windows.go for why this only means something there.
package lockprobe

// Busy always reports false away from Windows.
//
// This is the correct answer, not a stub. POSIX file locks are advisory: a
// process that locks a file does not stop anyone else from reading it, so there
// is no state here that would justify skipping a file. Pretending otherwise
// would make Linux and macOS runs skip files for no reason.
func Busy(path string) bool { return false }
