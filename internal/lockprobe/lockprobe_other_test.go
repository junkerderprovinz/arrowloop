//go:build !windows

package lockprobe

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// Errno 32 is ERROR_SHARING_VIOLATION on Windows but EPIPE here, so matching on
// the number alone would call a broken pipe a locked file.
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
