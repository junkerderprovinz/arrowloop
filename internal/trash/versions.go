package trash

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/operations"
)

// KeepVersion sets the file currently at rel aside before something overwrites
// it, and then prunes its history to keep versions.
//
// With keep below one it returns before any backend call. An error stops the
// overwrite: internal/apply turns it into a skip, and the next run tries again.
// rel comes from a plan, not a request, so it only gets the confinement check
// (see Store.at).
func KeepVersion(ctx context.Context, f fs.Fs, rel, runID string, keep int) error {
	if keep < 1 {
		return nil
	}
	if err := checkSegment(runID); err != nil {
		return err
	}

	obj, err := f.NewObject(ctx, rel)
	switch {
	case errors.Is(err, fs.ErrorObjectNotFound), errors.Is(err, fs.ErrorIsDir):
		return nil
	case err != nil:
		return fmt.Errorf("look at %q before it is overwritten: %w", rel, err)
	}

	dst, err := Versions.at(obj.Remote(), runID)
	if err != nil {
		return err
	}
	// Moved rather than copied, since the caller replaces the file next. If
	// the run dies in between, the next run sees a file deleted here and
	// edited on the other side, which restores it.
	if err := operations.MoveFile(ctx, f, f, dst, obj.Remote()); err != nil {
		return fmt.Errorf("keep the old version of %q: %w", rel, err)
	}
	return pruneVersions(ctx, f, obj.Remote(), keep)
}

// pruneVersions leaves the newest keep versions of one file and removes the
// rest. Sorting by name sorts by time because run identifiers are fixed-width
// timestamps.
func pruneVersions(ctx context.Context, f fs.Fs, rel string, keep int) error {
	dir, err := under(VersionsDir, rel)
	if err != nil {
		return err
	}
	entries, err := f.List(ctx, dir)
	if err != nil {
		if errors.Is(err, fs.ErrorDirNotFound) {
			return nil
		}
		return fmt.Errorf("read the kept versions of %q: %w", rel, err)
	}

	var kept []fs.Object
	for _, entry := range entries {
		if obj, ok := entry.(fs.Object); ok {
			kept = append(kept, obj)
		}
	}
	if len(kept) <= keep {
		return nil
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i].Remote() > kept[j].Remote() })
	for _, obj := range kept[keep:] {
		if err := obj.Remove(ctx); err != nil {
			return fmt.Errorf("remove the old version %q: %w", obj.Remote(), err)
		}
	}
	return nil
}

// RestoreVersion puts a kept version back as the live file. Unlike Restore it
// may replace an existing file, because it first copies that file into the
// history. It copies rather than moves, so the live file stays in place if
// the restore dies halfway.
func RestoreVersion(ctx context.Context, f fs.Fs, rel, runID string, now time.Time) error {
	dest, err := liveDest(rel)
	if err != nil {
		return err
	}
	src, err := Versions.remote(rel, runID)
	if err != nil {
		return err
	}
	if src == dest {
		// rclone treats a copy onto itself as a silent no-op.
		return fmt.Errorf("%w: %q is its own version", ErrNotAName, dest)
	}

	// Looked up first, so a wrong run identifier does not leave a copy of the
	// live file in the history.
	if _, err := f.NewObject(ctx, src); err != nil {
		return fmt.Errorf("look for the version of %q from run %s: %w", dest, runID, err)
	}

	switch _, err := f.NewObject(ctx, dest); {
	case errors.Is(err, fs.ErrorObjectNotFound):
	case err != nil:
		return fmt.Errorf("could not look at %q before replacing it: %w", dest, err)
	default:
		aside, err := Versions.at(dest, now.UTC().Format(RunIDLayout))
		if err != nil {
			return err
		}
		if err := operations.CopyFile(ctx, f, f, aside, dest); err != nil {
			return fmt.Errorf("keep the current %q before replacing it: %w", dest, err)
		}
	}

	return operations.CopyFile(ctx, f, f, dest, src)
}
