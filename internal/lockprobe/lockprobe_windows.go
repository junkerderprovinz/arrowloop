//go:build windows

// Package lockprobe asks whether a local file is currently held open by another
// program, so the engine can leave it alone instead of failing on it.
//
// Only Windows locks are mandatory; POSIX locks are advisory and do not stop a
// reader, so elsewhere the answer is always "not busy". The probe improves the
// message, not the guarantee: a file can be locked between the probe and the
// copy, so the apply stage still has to survive a failed transfer.
package lockprobe

import (
	"errors"
	"syscall"

	"golang.org/x/sys/windows"
)

// Busy reports whether the file at path cannot currently be opened for reading
// because another program holds it exclusively. Any other failure to open it
// is reported as not busy and left to the real operation.
func Busy(path string) bool {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	// FILE_SHARE_READ is what a reader needs, so this fails exactly when the
	// holder refused further readers.
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

// WasBusy reports whether an operation failed because another program was
// holding the file open.
//
// Busy cannot see a copy's destination or a lock taken after it was asked, and
// editors take a lock around every save, so most locked files show up as a
// failed operation. The error chain is inspected rather than the message,
// because Win32 error text is localised.
func WasBusy(err error) bool {
	if err == nil {
		return false
	}
	// x/sys/windows returns windows.Errno, the os package returns
	// syscall.Errno, and errors.As only matches the concrete type.
	var werr windows.Errno
	if errors.As(err, &werr) {
		return busyCode(uintptr(werr))
	}
	var serr syscall.Errno
	if errors.As(err, &serr) {
		return busyCode(uintptr(serr))
	}
	return false
}

// busyCode reports whether code is one of the ways Windows says another
// program has the file. ERROR_USER_MAPPED_FILE is what a rename or truncate
// gets when the holder has the file memory-mapped, as with a running
// executable or a database.
func busyCode(code uintptr) bool {
	switch code {
	case uintptr(windows.ERROR_SHARING_VIOLATION),
		uintptr(windows.ERROR_LOCK_VIOLATION),
		uintptr(windows.ERROR_USER_MAPPED_FILE):
		return true
	}
	return false
}
