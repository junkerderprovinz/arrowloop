//go:build windows

package lockprobe

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

// TestBusyAndWasBusyAgreeAboutARealLock checks both functions against a lock
// Windows really took.
func TestBusyAndWasBusyAgreeAboutARealLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("a document somebody has open"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	if Busy(path) {
		t.Fatal("a file nobody holds reported busy, so this test cannot prove anything")
	}
	free, err := os.Open(path)
	if err != nil {
		t.Fatalf("a file nobody holds would not open: %v", err)
	}
	// Closed now rather than deferred, or it would block the exclusive open.
	free.Close()

	// Share mode zero keeps the file to this handle.
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatalf("path: %v", err)
	}
	h, err := windows.CreateFile(p, windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatalf("could not take the lock this test is about: %v", err)
	}
	defer windows.CloseHandle(h)

	if !Busy(path) {
		t.Error("a locked file reported as free, so the run would go on to fail on it")
	}

	// The real error as the standard library wraps it, not a hand-built errno.
	_, err = os.Open(path)
	if err == nil {
		t.Fatal("a locked file opened, so Windows did not take the lock and the rest proves nothing")
	}
	if !WasBusy(err) {
		t.Errorf("the real failure was not recognised as a lock: %v", err)
	}
}

func TestWasBusyLeavesOtherFailuresAlone(t *testing.T) {
	_, err := os.Open(filepath.Join(t.TempDir(), "no-such-file.txt"))
	if err == nil {
		t.Fatal("opening a file that is not there succeeded")
	}
	if WasBusy(err) {
		t.Errorf("a missing file was reported as held open: %v", err)
	}
	if WasBusy(nil) {
		t.Error("no error at all was reported as held open")
	}
}
