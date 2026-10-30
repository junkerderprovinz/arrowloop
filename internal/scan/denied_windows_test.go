//go:build windows

package scan

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// An entry in a folder's ACL that shuts the process out, as on a temporary
// folder another program created for itself.
func TestAFolderTheACLShutsOutIsNotedAndTheRestListed(t *testing.T) {
	side := sideWithSubfolder(t)
	dir := filepath.Join(side.Root(), "Projects")
	if out, err := exec.Command("icacls", dir, "/deny", "*S-1-1-0:(RD)").CombinedOutput(); err != nil {
		t.Skipf("icacls could not deny the folder: %v: %s", err, out)
	}
	// Before the temporary directory goes, or it could not be removed.
	t.Cleanup(func() { _ = exec.Command("icacls", dir, "/remove:d", "*S-1-1-0").Run() })
	if _, err := os.ReadDir(dir); err == nil {
		t.Skip("this process holds the backup privilege, which reads past the ACL")
	}

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
