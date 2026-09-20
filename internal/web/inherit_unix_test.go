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

// On a 0777 share, a folder made under a container's umask of 022 would come
// out 0755. The umask is set here, since a suite running under 000 would pass
// either way.
func TestANewFolderIsAsWritableAsTheOneItSitsIn(t *testing.T) {
	was := syscall.Umask(0o022)
	t.Cleanup(func() { syscall.Umask(was) })

	h := newHarness(t)
	parent := t.TempDir()
	// The share's mode; t.TempDir makes 0700, which the umask leaves alone.
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

// The rule is to inherit, not to make folders world-writable.
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
