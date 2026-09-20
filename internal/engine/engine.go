// Package engine is the one path a sync run takes, shared by the command line
// and the tests so they cannot drift apart.
package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// Options is everything a run needs beyond the two ends and the record.
type Options struct {
	Compare plan.Options
	Exclude *filter.Set

	// EmptyDirs asks the job to carry directories that hold no files, at the
	// cost of a second listing pass and record.
	EmptyDirs bool

	// Metadata asks for permissions, ownership and extended attributes to be
	// carried along with the bytes, where both sides can do it.
	Metadata bool

	// ForceFoldCase overrides what the backends report about case sensitivity,
	// for tests.
	ForceFoldCase *bool

	// ForceEmptyDirs overrides the capability check, for tests.
	ForceEmptyDirs *bool
}

// StartAccounting turns on rclone's bandwidth limiting, once per process.
// rclone's binary does this from its flag parser; without it there is no token
// bucket and a limit is silently ignored. The limit is process-wide because
// the token bucket is.
//
// bwLimit takes rclone's syntax, such as "1M" or a timetable like
// "08:00,512k 19:00,off". An empty string leaves it unlimited.
func StartAccounting(ctx context.Context, bwLimit string) error {
	ci := fs.GetConfig(ctx)
	if bwLimit != "" {
		if err := ci.BwLimit.Set(bwLimit); err != nil {
			return fmt.Errorf("bandwidth limit %q: %w", bwLimit, err)
		}
	}
	accounting.Start(ctx)
	bwState.Lock()
	// accounting.Start only starts the timetable ticker when the timetable has
	// more than one entry at startup, so ApplyBwLimit may have to start it.
	bwState.ticking = len(ci.BwLimit) > 1
	bwState.started = true
	bwState.Unlock()
	return nil
}

// bwState remembers what StartAccounting did. accounting.Start is not safe to
// call twice, as each call starts another ticker goroutine.
var bwState struct {
	sync.Mutex
	started bool
	ticking bool
}

// ValidateBwLimit reports whether rclone would accept a limit, without applying
// it, so a bad limit is refused when saved rather than at the next start.
func ValidateBwLimit(bwLimit string) error {
	if bwLimit == "" {
		return nil
	}
	var t fs.BwTimetable
	if err := t.Set(bwLimit); err != nil {
		return fmt.Errorf("bandwidth limit %q: %w", bwLimit, err)
	}
	return nil
}

// ApplyBwLimit changes the limit on a running process. A plain limit, or the
// current slot of a timetable, applies from the next transferred block; later
// slots are followed by the ticker, which is started here if the process
// booted without a timetable.
func ApplyBwLimit(ctx context.Context, bwLimit string) error {
	if err := ValidateBwLimit(bwLimit); err != nil {
		return err
	}
	ci := fs.GetConfig(ctx)
	var t fs.BwTimetable
	if bwLimit != "" {
		if err := t.Set(bwLimit); err != nil {
			return fmt.Errorf("bandwidth limit %q: %w", bwLimit, err)
		}
	}
	ci.BwLimit = t

	bwState.Lock()
	defer bwState.Unlock()
	if !bwState.started {
		// StartAccounting will read the value just written.
		return nil
	}
	accounting.TokenBucket.SetBwLimit(t.LimitAt(time.Now()).Bandwidth)
	if len(t) > 1 && !bwState.ticking {
		accounting.TokenBucket.StartTokenTicker(ctx)
		bwState.ticking = true
	}
	return nil
}

// Configure returns a context carrying this job's rclone settings. fs.AddConfig
// copies the config into the context, so concurrent jobs do not change each
// other's settings.
func Configure(ctx context.Context, opt Options) context.Context {
	ctx, ci := fs.AddConfig(ctx)
	if opt.Compare.Transfers > 0 {
		ci.Transfers = opt.Compare.Transfers
		ci.Checkers = opt.Compare.Transfers
	}
	ci.Metadata = opt.Metadata
	return ctx
}

// Prepare lists both sides and works out what needs to happen. It changes
// nothing, so its result is safe to show to a user and to measure the safety
// brakes against.
func Prepare(ctx context.Context, ends apply.Ends, db *state.DB, opt Options) (*plan.Plan, plan.Options, error) {
	compare := opt.Compare
	compare.FoldCase = foldCase(ends, opt)

	prev, err := db.All(ctx)
	if err != nil {
		return nil, compare, err
	}
	// The record is filtered exactly as the sides are, or a newly excluded
	// path would read as a deletion.
	visible := make(map[string]state.Entry, len(prev))
	for key, entry := range prev {
		if opt.Exclude.Excluded(entry.LeftPath) || opt.Exclude.Excluded(entry.RightPath) || opt.Exclude.Excluded(key) {
			continue
		}
		visible[key] = entry
	}

	withDirs := opt.EmptyDirs && canHoldEmptyDirs(ends, opt)
	scanOpt := scan.Options{FoldCase: compare.FoldCase, Exclude: opt.Exclude, Dirs: withDirs}
	left, err := scan.List(ctx, ends.Left, scanOpt)
	if err != nil {
		return nil, compare, err
	}
	right, err := scan.List(ctx, ends.Right, scanOpt)
	if err != nil {
		return nil, compare, err
	}

	if err := somethingToWorkWith(ctx, ends, left, right, visible); err != nil {
		return nil, compare, err
	}

	p, err := plan.Build(ctx, left, right, visible, compare)
	if err != nil {
		return nil, compare, err
	}

	if withDirs {
		prevDirs, err := db.AllDirs(ctx)
		if err != nil {
			return nil, compare, err
		}
		visibleDirs := make(map[string]state.Dir, len(prevDirs))
		for key, entry := range prevDirs {
			if opt.Exclude.Excluded(entry.LeftPath) || opt.Exclude.Excluded(entry.RightPath) || opt.Exclude.Excluded(key) {
				continue
			}
			visibleDirs[key] = entry
		}
		p.Dirs = plan.BuildDirs(left, right, visibleDirs)
	}

	// After the directories, so a one-way job drops folder work on the
	// protected side too, and before the unsupported report, which covers both
	// sides.
	plan.Enforce(p, compare.Direction, compare.Mode)

	for side, f := range map[plan.Side]fs.Fs{plan.Left: ends.Left, plan.Right: ends.Right} {
		odd, err := scan.FindUnsupported(ctx, f, scanOpt)
		if err != nil {
			return nil, compare, err
		}
		for _, u := range odd {
			p.Skipped = append(p.Skipped, plan.Skip{
				Path:   u.Path,
				Reason: plan.Because("unsupported", "kind", u.Kind, "side", side.String()),
			})
		}
	}

	return p, compare, nil
}

// foldCase decides whether names are matched case-insensitively, one answer
// for the whole job (see pathid.Key).
func foldCase(ends apply.Ends, opt Options) bool {
	if opt.ForceFoldCase != nil {
		return *opt.ForceFoldCase
	}
	return caseInsensitive(ends.Left) || caseInsensitive(ends.Right)
}

func caseInsensitive(f fs.Fs) bool {
	if f == nil {
		return false
	}
	features := f.Features()
	return features != nil && features.CaseInsensitive
}

// canHoldEmptyDirs reports whether both ends have real directories. On a bucket
// backend such as S3 a folder is only a key prefix, so an empty one would be
// created again on every run.
func canHoldEmptyDirs(ends apply.Ends, opt Options) bool {
	if opt.ForceEmptyDirs != nil {
		return *opt.ForceEmptyDirs
	}
	return holdsDirs(ends.Left) && holdsDirs(ends.Right)
}

func holdsDirs(f fs.Fs) bool {
	if f == nil {
		return false
	}
	features := f.Features()
	return features != nil && features.CanHaveEmptyDirectories
}

// Execute carries out a plan that Prepare produced.
func Execute(ctx context.Context, ends apply.Ends, db *state.DB, p *plan.Plan, compare plan.Options) (apply.Result, error) {
	return apply.Run(ctx, ends, db, p, compare)
}

// ExecuteWatched is Execute with somebody watching the work go by.
func ExecuteWatched(ctx context.Context, ends apply.Ends, db *state.DB, p *plan.Plan, compare plan.Options, watcher apply.Progress) (apply.Result, error) {
	return apply.RunWatched(ctx, ends, db, p, compare, watcher)
}

// Once prepares and executes in a single call.
func Once(ctx context.Context, ends apply.Ends, db *state.DB, opt Options) (*plan.Plan, apply.Result, error) {
	return OnceWatched(ctx, ends, db, opt, nil)
}

// OnceWatched prepares and executes with somebody watching.
func OnceWatched(ctx context.Context, ends apply.Ends, db *state.DB, opt Options, watcher apply.Progress) (*plan.Plan, apply.Result, error) {
	p, compare, err := Prepare(ctx, ends, db, opt)
	if err != nil {
		return nil, apply.Result{}, err
	}
	res, err := ExecuteWatched(ctx, ends, db, p, compare, watcher)
	return p, res, err
}

// NothingToSyncError says a job's sides do not exist, usually because of a
// typo, an unmounted share or a detached drive.
type NothingToSyncError struct {
	Missing []string
}

func (e *NothingToSyncError) Error() string {
	return fmt.Sprintf(
		"this job has nothing to work with: %s does not exist; check the path, and that any removable drive is attached or share mounted",
		strings.Join(e.Missing, " and "))
}

// somethingToWorkWith refuses a job whose sides are not there.
//
// A job with a record is left to plan.Build, which refuses an emptied side
// with a better message. When both sides list empty, each is asked whether it
// exists, since a folder holding only symlinks or excluded files lists empty
// too.
func somethingToWorkWith(ctx context.Context, ends apply.Ends, left, right *scan.Listing, visible map[string]state.Entry) error {
	if len(visible) > 0 {
		return nil
	}
	if len(left.Files)+len(left.Dirs)+len(right.Files)+len(right.Dirs) > 0 {
		return nil
	}

	var missing []string
	for _, f := range []fs.Fs{ends.Left, ends.Right} {
		if _, err := f.List(ctx, ""); errors.Is(err, fs.ErrorDirNotFound) {
			missing = append(missing, describe(f))
		}
	}
	if len(missing) == 0 {
		return nil
	}
	return &NothingToSyncError{Missing: missing}
}

// describe names a side the way a person would recognise it.
func describe(f fs.Fs) string { return f.Name() + ":" + f.Root() }
