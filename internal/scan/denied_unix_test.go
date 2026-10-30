//go:build unix

package scan

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAFolderWithoutPermissionsIsNotedAndTheRestListed(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root opens every folder")
	}
	side := sideWithSubfolder(t)
	dir := filepath.Join(side.Root(), "Projects")
	if err := os.Chmod(dir, 0); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	// Before the temporary directory goes, or it could not be removed.
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	l, err := List(context.Background(), side, Options{})
	if err != nil {
		t.Fatalf("one unreadable folder failed the scan: %v", err)
	}
	if len(l.Files) != 1 || l.Files["top.txt"] == nil {
		t.Fatalf("listed %v, want only top.txt", l.Files)
	}
	if len(l.Unreadable) != 1 || l.Unreadable[0].Path != "Projects" || l.Unreadable[0].Gone {
		t.Fatalf("unreadable %+v, want Projects as refused", l.Unreadable)
	}
}
