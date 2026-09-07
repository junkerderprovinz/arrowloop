//go:build !windows

package lockprobe

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// TestNothingIsHeldOpenAwayFromWindows pins the answer this package gives
// everywhere else, which is "no" and is correct rather than unfinished.
//
// POSIX locks are advisory: a process that locks a file does not stop anyone
// reading it. A future edition that started reporting busy here would make
// Linux and macOS runs postpone files for a condition that does not prevent
// anything, and the files would be postponed on every run forever.
//
// Errno 32 is the interesting line. It is ERROR_SHARING_VIOLATION on Windows,
// which is exactly what the other branch of this package looks for, and EPIPE
// here, which is a broken pipe and has nothing to do with anybody holding a
// file. A classifier that matched on the number alone rather than on the
// platform would call a dead network connection a document somebody left open.
func TestNothingIsHeldOpenAwayFromWindows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("anything"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if Busy(path) {
		t.Error("a file reported busy on a system where nothing can hold one")
	}

	for _, err := range []error{
		nil,
		errors.New("no space left on device"),
		&os.PathError{Op: "open", Path: path, Err: syscall.Errno(32)},
		os.ErrPermission,
	} {
		if WasBusy(err) {
			t.Errorf("%v was reported as a file another program is holding open", err)
		}
	}
}
