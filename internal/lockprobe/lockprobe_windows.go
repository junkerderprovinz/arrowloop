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
	"errors"
	"syscall"

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

// WasBusy reports whether an operation failed because another program was
// holding the file open.
//
// Busy is asked before an operation and this is asked after one, and both are
// needed. Busy cannot see the destination of a copy without opening it, which
// would be an intrusion of its own, and it cannot see a lock taken in the
// moment between the question and the transfer. That gap is not a rare race: a
// text editor or an office suite takes and releases a lock around every save,
// so the everyday way a sync run meets a locked file is by failing on it, not
// by predicting it.
//
// Without this the run recorded such a file under the generic "step failed"
// reason with a raw Win32 sentence attached, sitting in a list beside genuine
// failures such as a full disk or a refused permission. The two want opposite
// things from the person reading: one is "close the document", the other is
// "something is wrong". Nothing in the record told them apart.
//
// The error chain is walked rather than the message matched. Win32 error text
// is localised, so a run on a German or Japanese Windows would silently stop
// recognising its own most common failure, and it would do so only on the
// machines nobody tests on.
func WasBusy(err error) bool {
	if err == nil {
		return false
	}
	// Both spellings, because the same numeric code arrives as either type
	// depending on which library wrapped it: golang.org/x/sys/windows returns
	// windows.Errno, the standard library's os package returns syscall.Errno,
	// and errors.As only matches the concrete type it is handed.
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

// busyCode names the three ways Windows says "somebody else has this".
//
// ERROR_USER_MAPPED_FILE belongs here with the other two even though it reads
// like something else: it is what a rename or a truncate gets when the holder
// has the file memory-mapped, which is how a running executable and a database
// are held, and from outside it is the same situation with the same remedy.
func busyCode(code uintptr) bool {
	switch code {
	case uintptr(windows.ERROR_SHARING_VIOLATION),
		uintptr(windows.ERROR_LOCK_VIOLATION),
		uintptr(windows.ERROR_USER_MAPPED_FILE):
		return true
	}
	return false
}
