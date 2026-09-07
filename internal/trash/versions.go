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

// A history of a file that is only ever edited is the gap the trash never
// covered.
//
// A deletion goes to the trash and a conflict keeps the losing version beside
// the winner, so the two dramatic cases already leave something behind. The
// undramatic one does not: a document edited on one side and copied over the
// other side's copy on every run leaves no trace of what was there before, and
// that is the case where somebody actually wants yesterday's file back.
//
// The mechanism is deliberately the one internal/apply already has rather than a
// second one. toTrash moves a file to a name under the reserved prefix, which
// internal/scan skips on both sides, and that single property is what makes the
// copy safe to leave inside the tree: it never syncs, it never comes back as a
// file somebody created, and it works on a bucket where there is no "outside the
// tree" to put it in. Everything below is that same move to a different name.

// KeepVersion sets the file currently at rel aside before something overwrites
// it, and then prunes the history to keep versions.
//
// Off unless asked for, and the check is the first line for a reason that is not
// style: keep at zero must cost nothing at all, not even the metadata call that
// asks whether there is a file to preserve. A run over ten thousand unchanged
// files should not make ten thousand requests to support a feature nobody
// switched on.
//
// A failure here has to reach the caller and stop the overwrite. That is the
// whole promise: somebody who asked for the last three versions of their files
// and got an overwrite instead, because setting the old one aside quietly failed,
// has been given the exact outcome the setting exists to prevent. In
// internal/apply a returned error turns the copy into a skip with a reason, the
// run carries on, and the next run tries the same file again, which is what
// should happen to a file whose old version could not be saved.
//
// rel is the backend's own spelling of the path, taken from a plan rather than
// from a request, so it goes through the confinement check and not the stricter
// one that a wire value needs. See Store.at.
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
		// Nothing is being overwritten, so there is nothing to keep. This is the
		// ordinary case for a file arriving on a side for the first time, and it
		// must not be an error: a new file is not a failed version.
		return nil
	case err != nil:
		return fmt.Errorf("look at %q before it is overwritten: %w", rel, err)
	}

	dst, err := Versions.at(obj.Remote(), runID)
	if err != nil {
		return err
	}
	// Moved rather than copied, which is the opposite choice from
	// RestoreVersion below and worth reading twice. The bytes at rel are about to
	// be replaced by the caller anyway, so copying them would write the file
	// twice for no gain. A run that dies between this move and the copy that
	// follows leaves the path missing on this side while the other side holds the
	// edited file, which is the "deleted on one side, edited on the other" row
	// that the decision table restores rather than propagates. That is the same
	// argument conflictSteps makes for its own ordering, and it holds for the
	// same reason.
	if err := operations.MoveFile(ctx, f, f, dst, obj.Remote()); err != nil {
		return fmt.Errorf("keep the old version of %q: %w", rel, err)
	}
	return pruneVersions(ctx, f, obj.Remote(), keep)
}

// pruneVersions leaves the newest keep versions of one file and removes the
// rest.
//
// One listing of one directory, which is the entire reason versions are filed
// under the path rather than under the run the way the trash is. Filed the other
// way round, keeping the last three versions of one file would mean walking every
// run ever recorded and grouping by path, on every single overwrite.
//
// Sorted by name, which is sorting by time, because a run identifier is a
// fixed-width zero-padded timestamp. That is load bearing rather than
// convenient: an identifier that ever became variable-width would quietly turn
// this into a sort by nothing in particular, and the versions it removed would be
// an arbitrary selection rather than the oldest.
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

// RestoreVersion puts a kept version back as the live file.
//
// This is the one restore that is allowed to land on a name that is occupied,
// and only because it puts a bin behind itself first. The rule Restore enforces
// is not "never overwrite", it is "never destroy something with nothing behind
// it", and a version restore that saved the current file as a new version first
// has honoured that rule rather than dodged it. Refusing outright instead would
// make the whole feature unreachable: the live file is always there, so a
// refusal on that ground would refuse every single time.
//
// The current file is COPIED into the history and not moved, which is the
// opposite of what KeepVersion does and is deliberate. Here there is no
// guaranteed overwrite coming afterwards to justify the gap: a run that died
// between a move and the copy would leave the live path missing, on a tree
// nobody was syncing at the time, purely because somebody pressed restore. A copy
// costs the bytes once and leaves the live file untouched until the moment it is
// replaced.
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
		// Unreachable through the exported surface, because dest never starts
		// with the reserved prefix once the check below has run. Kept because a
		// copy of a file onto itself is the one shape rclone answers by doing
		// nothing at all, and a silent success is the worst possible answer to a
		// restore.
		return fmt.Errorf("%w: %q is its own version", ErrNotAName, dest)
	}

	// The version is looked for before anything is preserved. A request naming a
	// version that was never kept cannot succeed, and doing the preserving copy
	// first would write a whole file's worth of bytes into the history to serve
	// a request that then fails, leaving a version nobody asked for behind every
	// mistyped run identifier.
	if _, err := f.NewObject(ctx, src); err != nil {
		return fmt.Errorf("look for the version of %q from run %s: %w", dest, runID, err)
	}

	switch _, err := f.NewObject(ctx, dest); {
	case errors.Is(err, fs.ErrorObjectNotFound):
		// The live file is gone, which is a perfectly ordinary way to arrive
		// here: somebody deleted it and then asked for a version of it back.
		// There is nothing to keep, so nothing is kept.
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
