//go:build windows

package hidden

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestAFolderIsHiddenAndAMissingOneIgnored(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".arrowloop")
	Folder(dir)
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	Folder(dir)
	p, _ := windows.UTF16PtrFromString(dir)
	attrs, err := windows.GetFileAttributes(p)
	if err != nil {
		t.Fatal(err)
	}
	if attrs&windows.FILE_ATTRIBUTE_HIDDEN == 0 {
		t.Error("the folder is still visible")
	}
}
