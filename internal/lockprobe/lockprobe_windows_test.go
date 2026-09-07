//go:build windows

package lockprobe

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

// TestBusyAndWasBusyAgreeAboutARealLock drives both halves of the package
// against a lock Windows really took, rather than against a number copied out
// of a header.
//
// The two answers have to agree. Busy is asked before an operation and WasBusy
// after one, and a pair that disagreed would produce a run that skipped a file
// as held open and then, on the next run, reported the same file as a plain
// failure, with nothing to tell the reader they were the same event.
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
	// Closed before the lock is taken, and not with a defer. This test's own
	// open handle is enough to stop the exclusive open below, which is the
	// whole mechanism under test working correctly against the wrong process.
	free.Close()

	// Share mode zero is what a program that means to keep a file to itself
	// asks for, and it is what makes the file genuinely unreadable to everyone
	// else. This is the situation, not an imitation of it.
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

	// The error the operating system hands back through the standard library,
	// wrappers and all. Recognising a hand-built errno and not this one would
	// be a guard that only works in its own test.
	_, err = os.Open(path)
	if err == nil {
		t.Fatal("a locked file opened, so Windows did not take the lock and the rest proves nothing")
	}
	if !WasBusy(err) {
		t.Errorf("the real failure was not recognised as a lock: %v", err)
	}
}

// TestWasBusyLeavesOtherFailuresAlone is the other direction. A classifier that
// answered yes too readily would relabel a full disk or a refused permission as
// "close the document", which is worse than the generic reason it replaced:
// somebody would go looking for an open window that does not exist.
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
