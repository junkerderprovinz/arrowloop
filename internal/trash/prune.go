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
// against.
//
// It lives here rather than in the handler that reads the number, because the
// refusal below is the interesting half and a handler cannot be tested from the
// package that owns the rule. Zero days is refused outright: it means "delete
// everything", which may well be a thing somebody wants, and it must not be
// something they GET. A form field that was never filled in decodes to zero, and
// a request that lost a field on the way would otherwise empty the whole trash
// while looking exactly like a request to tidy it.
//
// A negative number is a date in the future and would delete everything twice
// over, so it is refused in the same breath.
func Cutoff(now time.Time, days int) (time.Time, error) {
	if days < 1 {
		return time.Time{}, fmt.Errorf("%d days is not an age; emptying the trash completely is a separate decision and has to be asked for as one", days)
	}
	return now.Add(-time.Duration(days) * 24 * time.Hour).UTC(), nil
}

// Pruned is what a prune removed, so that the answer can say what happened
// rather than only that something did.
type Pruned struct {
	// Runs are the run identifiers whose directories were removed, oldest
	// first.
	Runs []string
	// Entries is how many files were in them.
	Entries int
	// Bytes is how much room that gave back. Worth reporting because the reason
	// anybody empties a trash is almost always space, and "eleven files" does
	// not answer that question.
	Bytes int64
	// Unknown is how many entries were left alone because their age could not
	// be established. Reported rather than swallowed: a prune that says it
	// removed nothing, on a trash somebody can see is full, has to be able to
	// explain itself.
	Unknown int
}

// PruneOlderThan removes whole runs that were filed before the cutoff.
//
// Whole runs, and that follows from where the time comes from. Every file in
// .arrowloop/trash/<run>/ was deleted by that one run, so they all share one age
// and there is no per-file decision to make. It also means the removal is a purge
// of a few directories rather than thousands of individual deletes, which on a
// bucket backend is the difference between one request and one per object.
//
// An entry whose run identifier does not parse is never touched. That is not
// caution for its own sake: the only other time available is the file's own
// modification time, which survives the move into the trash, so a document last
// edited years ago and deleted this morning would read as ancient and be
// destroyed by a request to clear out last year. There is no bin behind this one,
// so an unknown age means no.
func PruneOlderThan(ctx context.Context, f fs.Fs, store Store, cutoff time.Time) (Pruned, error) {
	var out Pruned
	if store.layout != runFirst {
		// The versions store is filed the other way round, one directory per
		// file rather than one per run, and it is pruned by count as each new
		// version is kept. Pruning it by age here would walk the wrong shape and
		// would answer a question nobody asked of it.
		return out, fmt.Errorf("the %s store is pruned by how many versions are kept, not by age", store.name)
	}

	entries, err := List(ctx, f, store)
	if err != nil {
		return out, err
	}

	// Grouped rather than deleted file by file as the listing goes, so that a
	// run is only ever removed as a whole. A loop that purged as it walked would
	// be removing directories out from under the walk it is still reading.
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
	// Oldest first, so that a prune interrupted halfway has removed the runs
	// that were furthest past the cutoff rather than an arbitrary handful.
	sort.Strings(out.Runs)

	for _, run := range out.Runs {
		dir, err := under(store.dir, run)
		if err != nil {
			// The identifier came from a listing of this very directory, so this
			// cannot fire from a wire value. It fires if a backend ever hands
			// back a name that is not one, and stopping is the only safe answer
			// to a purge whose target could not be described.
			return out, err
		}
		if err := operations.Purge(ctx, f, dir); err != nil && !errors.Is(err, fs.ErrorDirNotFound) {
			return out, fmt.Errorf("empty %s: %w", dir, err)
		}
	}
	return out, nil
}
