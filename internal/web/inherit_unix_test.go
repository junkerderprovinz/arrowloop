//go:build !windows

package web_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// TestANewFolderIsAsWritableAsTheOneItSitsIn.
//
// The report this exists for, with the Windows dialog attached: two folders
// created through the browse panel on an Unraid share could be opened and not
// written to. Measured on the box, which is what named the cause - the share is
// `nobody:users` 0777 and both folders came out `root:root` 0755, because the
// mode handed to Mkdir is masked by the process umask and a container's default
// is 022.
//
// The umask is set deliberately in this test rather than trusted: it is process
// state, so a suite that happened to run under 000 would pass with the fix
// removed, and a guard that can only fail under one ambient setting is a guard
// that reports nothing. 022 is what a container has.
func TestANewFolderIsAsWritableAsTheOneItSitsIn(t *testing.T) {
	was := syscall.Umask(0o022)
	t.Cleanup(func() { syscall.Umask(was) })

	h := newHarness(t)
	parent := t.TempDir()
	// The share's own mode. t.TempDir() makes 0700, which cannot show the
	// defect: 0700 masked by 022 is still 0700.
	if err := os.Chmod(parent, 0o777); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"parent": parent, "name": "testlinks"})
	resp, said := doJSON(t, h.srv, http.MethodPost, "/api/browse/mkdir", string(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the folder was refused: %s %s", resp.Status, said)
	}

	made, err := os.Stat(filepath.Join(parent, "testlinks"))
	if err != nil {
		t.Fatal(err)
	}
	want := os.FileMode(0o777)
	if got := made.Mode().Perm(); got != want {
		t.Errorf("a folder made inside a %v parent came out %v, so whoever owns the parent cannot write to it", want, got)
	}
}

// TestInheritingLeavesAPrivateFolderPrivate.
//
// The rule is INHERIT, not "make it world-writable". A folder created inside a
// private directory has to stay private, or a fix for a share would quietly
// open up every folder anybody makes on their own disk.
func TestInheritingLeavesAPrivateFolderPrivate(t *testing.T) {
	was := syscall.Umask(0o022)
	t.Cleanup(func() { syscall.Umask(was) })

	h := newHarness(t)
	parent := t.TempDir()
	if err := os.Chmod(parent, 0o700); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"parent": parent, "name": "privat"})
	resp, said := doJSON(t, h.srv, http.MethodPost, "/api/browse/mkdir", string(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the folder was refused: %s %s", resp.Status, said)
	}

	made, err := os.Stat(filepath.Join(parent, "privat"))
	if err != nil {
		t.Fatal(err)
	}
	if got := made.Mode().Perm(); got != 0o700 {
		t.Errorf("a folder made inside a private parent came out %v, so the fix for a share widened a private disk", got)
	}
}
