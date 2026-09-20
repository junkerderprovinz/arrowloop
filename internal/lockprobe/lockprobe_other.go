//go:build !windows

// Package lockprobe asks whether a local file is currently held open by another
// program. See lockprobe_windows.go for why this only means something there.
package lockprobe

// Busy always reports false away from Windows, because POSIX locks are
// advisory and do not stop a reader.
func Busy(path string) bool { return false }

// WasBusy always reports false away from Windows. It exists so callers have the
// same shape on every platform without build tags.
func WasBusy(err error) bool { return false }
