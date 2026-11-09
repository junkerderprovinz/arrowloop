package scan

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/filter"
)

func symlinkOrSkip(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("this system does not let the test create a symlink: %v", err)
	}
}

func TestTheListingNamesSymlinksItCannotCarry(t *testing.T) {
	side := sideWithSubfolder(t)
	symlinkOrSkip(t, filepath.Join(side.Root(), "top.txt"), filepath.Join(side.Root(), "Projects", "link.txt"))

	l, err := List(context.Background(), side, Options{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(l.Unsupported) != 1 || l.Unsupported[0].Path != "Projects/link.txt" || l.Unsupported[0].Kind != "symbolic link" {
		t.Fatalf("unsupported %+v, want Projects/link.txt as a symbolic link", l.Unsupported)
	}
	if l.Files["projects/link.txt"] != nil || l.Files["Projects/link.txt"] != nil {
		t.Fatal("the symlink was listed as a file")
	}
}

func TestAnExcludedSymlinkIsNotNamed(t *testing.T) {
	side := sideWithSubfolder(t)
	symlinkOrSkip(t, filepath.Join(side.Root(), "top.txt"), filepath.Join(side.Root(), "Projects", "link.txt"))
	exclude, err := filter.New([]string{"Projects/**"})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}

	l, err := List(context.Background(), side, Options{Exclude: exclude})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(l.Unsupported) != 0 {
		t.Fatalf("unsupported %+v, want none", l.Unsupported)
	}
}
