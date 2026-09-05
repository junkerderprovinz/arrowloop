//go:build windows

// Package lockprobe asks whether a local file is currently held open by another
// program, so the engine can leave it alone instead of failing on it.
//
// This is Windows-only by nature, not by omission. Windows locking is
// mandatory: a program that opens a file without sharing it makes the file
// genuinely unreadable to everyone else, which is why "the file is open in
// another program" is a Windows phrase. POSIX locks are advisory and do not
// stop a reader, so on Linux and macOS there is nothing to probe and the
// fallback correctly answers "not busy".
//
// It is an optimisation for the error message, not a guarantee. The file can be
// locked in the moment between the probe and the copy, so the apply stage still
// has to survive a failed transfer. What the probe buys is a run that says "held
// open by another program" instead of surfacing a raw sharing violation.
package lockprobe

import (
	"golang.org/x/sys/windows"
)

// Busy reports whether the file at path cannot currently be opened for reading
// because another program holds it exclusively.
//
// A file that does not exist, or that cannot be opened for any other reason, is
// reported as not busy: this probe only ever answers the one question, and
// every other problem belongs to whoever tries the real operation.
func Busy(path string) bool {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	// dwShareMode of FILE_SHARE_READ mirrors what a reader needs: if the holder
	// opened the file without allowing further readers, this fails and the file
	// really is unreadable to us.
	h, err := windows.CreateFile(
		p,
		windows.GENERIC_READ,
		windows.FILE_SHARE_READ,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		return err == windows.ERROR_SHARING_VIOLATION || err == windows.ERROR_LOCK_VIOLATION
	}
	windows.CloseHandle(h)
	return false
}
