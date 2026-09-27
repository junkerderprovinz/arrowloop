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

// Cutoff turns "older than N days" into the instant everything is compared
// against. Fewer than one day is refused, because a form field that was never
// filled in decodes to zero and would empty the whole trash.
func Cutoff(now time.Time, days int) (time.Time, error) {
	if days < 1 {
		return time.Time{}, fmt.Errorf("%d days is not an age; emptying the trash completely is a separate decision and has to be asked for as one", days)
	}
	return now.Add(-time.Duration(days) * 24 * time.Hour).UTC(), nil
}

// Pruned is what a prune removed.
type Pruned struct {
	// Runs are the run identifiers whose directories were removed, oldest
	// first.
	Runs []string
	// Entries is how many files were in them.
	Entries int
	// Bytes is how much room that gave back.
	Bytes int64
	// Unknown is how many entries were left alone because their age is not
	// known.
	Unknown int
}

// Empty removes everything a store holds on one side, entries of unknown age
// included, since emptying means all of it.
func Empty(ctx context.Context, f fs.Fs, store Store) (Pruned, error) {
	var out Pruned
	if store.layout != runFirst {
		return out, fmt.Errorf("the %s store is pruned by how many versions are kept, not emptied", store.name)
	}
	entries, err := List(ctx, f, store)
	if err != nil {
		return out, err
	}
	for _, e := range entries {
		out.Entries++
		out.Bytes += e.Size
	}
	// Not purged when there is nothing in it: on Windows a purge of a folder
	// that was never made fails with a path error rather than ErrorDirNotFound.
	if out.Entries == 0 {
		return out, nil
	}
	if err := operations.Purge(ctx, f, store.dir); err != nil && !errors.Is(err, fs.ErrorDirNotFound) {
		return out, fmt.Errorf("empty %s: %w", store.dir, err)
	}
	return out, nil
}

// Delete removes one entry for good. Nothing is kept behind it, so a caller
// asks first.
func Delete(ctx context.Context, f fs.Fs, store Store, rel, runID string) error {
	src, err := store.remote(rel, runID)
	if err != nil {
		return err
	}
	obj, err := f.NewObject(ctx, src)
	if err != nil {
		return fmt.Errorf("find %q in the %s: %w", rel, store.name, err)
	}
	return operations.DeleteFile(ctx, obj)
}

// PruneOlderThan removes whole runs that were filed before the cutoff. Every
// file in a run directory shares the run's age, so this purges a few
// directories rather than deleting file by file. Entries of unknown age are
// never touched (see RunIDLayout).
func PruneOlderThan(ctx context.Context, f fs.Fs, store Store, cutoff time.Time) (Pruned, error) {
	var out Pruned
	if store.layout != runFirst {
		return out, fmt.Errorf("the %s store is pruned by how many versions are kept, not by age", store.name)
	}

	entries, err := List(ctx, f, store)
	if err != nil {
		return out, err
	}

	doomed := map[string]bool{}
	for _, e := range entries {
		if !e.Known() {
			out.Unknown++
			continue
		}
		if !e.Filed.Before(cutoff) {
			continue
		}
		doomed[e.RunID] = true
		out.Entries++
		out.Bytes += e.Size
	}
	for run := range doomed {
		out.Runs = append(out.Runs, run)
	}
	// Oldest first, so an interrupted prune has removed the oldest runs.
	sort.Strings(out.Runs)

	for _, run := range out.Runs {
		dir, err := under(store.dir, run)
		if err != nil {
			return out, err
		}
		if err := operations.Purge(ctx, f, dir); err != nil && !errors.Is(err, fs.ErrorDirNotFound) {
			return out, fmt.Errorf("empty %s: %w", dir, err)
		}
	}
	return out, nil
}
