package scan

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/fserrors"

	"github.com/junkerderprovinz/arrowloop/internal/filter"
)

// failing is a local side on which one folder fails to list.
type failing struct {
	fs.Fs
	dir  string
	fail func(ctx context.Context) (fs.DirEntries, error)
}

func (f failing) List(ctx context.Context, dir string) (fs.DirEntries, error) {
	if dir == f.dir {
		return f.fail(ctx)
	}
	return f.Fs.List(ctx, dir)
}

func sideWithSubfolder(t *testing.T) fs.Fs {
	t.Helper()
	root := t.TempDir()
	for _, rel := range []string{"top.txt", "Projects/plan.txt"} {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(full, []byte(rel), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}
	f, err := fs.NewFs(context.Background(), root)
	if err != nil {
		t.Fatalf("fs: %v", err)
	}
	return f
}

// The local backend answers a folder it cannot stat, such as one on a share
// that dropped for a moment, with the error for a folder that is not there.
// Taken as a missing side, the folder's files would read as deleted.
func TestASubfolderThatFailsToListFailsTheScan(t *testing.T) {
	f := failing{Fs: sideWithSubfolder(t), dir: "Projects", fail: func(context.Context) (fs.DirEntries, error) {
		return nil, fs.ErrorDirNotFound
	}}
	if l, err := List(context.Background(), f, Options{}); err == nil {
		t.Fatalf("the scan succeeded without the folder: %d files", len(l.Files))
	}
}

// A folder the process may not open is listed as empty by the local backend,
// which only counts the error.
func TestAFolderThatMayNotBeOpenedFailsTheScan(t *testing.T) {
	f := failing{Fs: sideWithSubfolder(t), dir: "Projects", fail: func(ctx context.Context) (fs.DirEntries, error) {
		_ = accounting.Stats(ctx).Error(fserrors.NoRetryError(errors.New("permission denied")))
		return nil, nil
	}}
	if l, err := List(context.Background(), f, Options{}); err == nil {
		t.Fatalf("the scan succeeded without the folder: %d files", len(l.Files))
	}
}

// The target of a new job is often a folder nobody has created yet.
func TestASideThatDoesNotExistListsEmpty(t *testing.T) {
	f, err := fs.NewFs(context.Background(), filepath.Join(t.TempDir(), "not-yet"))
	if err != nil {
		t.Fatalf("fs: %v", err)
	}
	l, err := List(context.Background(), f, Options{})
	if err != nil {
		t.Fatalf("a side that does not exist yet was refused: %v", err)
	}
	if len(l.Files) != 0 {
		t.Fatalf("listed %d files", len(l.Files))
	}
}

// The local backend opens a folder before the job's patterns are applied, and
// a drive root holds folders the process may not open. Those the job excludes
// must not fail its scan.
func TestAnExcludedFolderThatMayNotBeOpenedIsSkipped(t *testing.T) {
	for _, dir := range []string{"System Volume Information", "Projects/System Volume Information", MetaDir} {
		t.Run(dir, func(t *testing.T) {
			side := sideWithSubfolder(t)
			if err := os.MkdirAll(filepath.Join(side.Root(), filepath.FromSlash(dir)), 0o755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			f := failing{Fs: side, dir: dir, fail: func(ctx context.Context) (fs.DirEntries, error) {
				_ = accounting.Stats(ctx).Error(fserrors.NoRetryError(errors.New("permission denied")))
				return nil, nil
			}}
			exclude, err := filter.New([]string{"**/System Volume Information/**"})
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			l, err := List(context.Background(), f, Options{Exclude: exclude})
			if err != nil {
				t.Fatalf("an excluded folder failed the scan: %v", err)
			}
			if len(l.Files) != 2 {
				t.Fatalf("listed %d files, want 2", len(l.Files))
			}
		})
	}
}
