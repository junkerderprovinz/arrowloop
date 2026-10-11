//go:build windows

package daemon

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestTheFolderARunCreatesIsHidden(t *testing.T) {
	r, left, right := syncedPair(t)
	if err := os.Remove(filepath.Join(left, "datei-00.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("the run: %v", err)
	}

	meta := filepath.Join(right, ".arrowloop")
	p, _ := windows.UTF16PtrFromString(meta)
	attrs, err := windows.GetFileAttributes(p)
	if err != nil {
		t.Fatalf("the run left no folder for the bin: %v", err)
	}
	if attrs&windows.FILE_ATTRIBUTE_HIDDEN == 0 {
		t.Error("the folder the run made is visible")
	}
}
