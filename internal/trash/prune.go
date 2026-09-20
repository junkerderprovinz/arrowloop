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
