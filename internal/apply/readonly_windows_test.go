//go:build windows

package apply_test

import (
	"os"
	"path/filepath"
	"testing"
)

// Git writes its objects and commit graphs read-only, so a backup of a working
// copy keeps meeting read-only files it has to replace.
func TestAReadOnlyFileOnTheFarSideIsReplaced(t *testing.T) {
	j := newLockJob(t)
	far := filepath.Join(j.right, "notes.txt")
	if err := os.Chmod(far, 0o444); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	writeTo(t, j.left, "notes.txt", "a commit graph that moved on")

	res := runJob(t, j)
	if len(res.Skipped) > 0 {
		t.Fatalf("the read-only file was left for the next run: %+v", res.Skipped)
	}
	if got := readOrEmpty(t, far); got != "a commit graph that moved on" {
		t.Errorf("the far side holds %q after the run", got)
	}
}
