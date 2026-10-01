package watch_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/watch"
)

// Windows refuses to rename a folder while anything below it is held open,
// and a watch is an open handle.
func TestAFolderWithSubfoldersCanBeRenamedWhileWatched(t *testing.T) {
	root, fired := harness(t, watch.Options{})

	if err := os.MkdirAll(filepath.Join(root, "Projects", "2024"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, filepath.Join(root, "Projects", "2024", "plan.txt"), "x")
	waitFor(t, fired, 1, "creating the folders")

	if err := os.Rename(filepath.Join(root, "Projects"), filepath.Join(root, "Archive")); err != nil {
		t.Fatalf("the watcher keeps a folder from being renamed: %v", err)
	}

	before := fired.Load()
	write(t, filepath.Join(root, "Archive", "2024", "after.txt"), "x")
	waitFor(t, fired, before+1, "a file in the renamed folder")
}
