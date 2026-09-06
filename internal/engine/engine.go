// Package engine is the one path a sync run takes.
//
// It exists so that the command line and the tests cannot drift apart. A test
// that assembles the stages itself would eventually prove that a sequence
// nobody ships works correctly, which is worse than no test at all.
package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"

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

	// EmptyDirs asks the job to carry directories that hold no files. Off by
	// default: it costs a second listing pass and a second record, and most
	// jobs never notice the difference.
	EmptyDirs bool

	// Metadata asks for permissions, ownership and extended attributes to be
	// carried along with the bytes, where both sides can do it.
	Metadata bool

	// ForceFoldCase overrides what the backends report about case sensitivity.
	// Only the tests need it: the real answer comes from the filesystems.
	ForceFoldCase *bool

	// ForceEmptyDirs overrides the capability check, for tests.
	ForceEmptyDirs *bool
}

// StartAccounting turns on rclone's bandwidth limiting, once per process.
//
// rclone's own binary does this from its flag parser, which is easy to mistake
// for something that happens automatically. It does not: without this call
// there is no token bucket, so a bandwidth limit is accepted and then silently
// ignored, which is the worst of both answers.
//
// The limit is process-wide and not per job, because the token bucket is. Two
// jobs sharing a machine share one uplink, so a per-job limit would be a
// promise the underlying mechanism cannot keep.
//
// bwLimit takes rclone's own syntax, so "1M" or a timetable like
// "08:00,512k 19:00,off". An empty string leaves it unlimited.
func StartAccounting(ctx context.Context, bwLimit string) error {
	ci := fs.GetConfig(ctx)
	if bwLimit != "" {
		if err := ci.BwLimit.Set(bwLimit); err != nil {
			return fmt.Errorf("bandwidth limit %q: %w", bwLimit, err)
		}
	}
	accounting.Start(ctx)
	return nil
}

// Configure returns a context carrying this job's rclone settings.
//
// It uses fs.AddConfig, which copies the config into the context rather than
// changing the process-wide one. That matters as soon as two jobs run at the
// same time: one job asking for metadata, or for eight transfers, must not
// quietly change what the other job is doing.
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
	// The record has to be filtered exactly as the sides are. A path that is
	// newly excluded has not been deleted, and leaving its row in place while
	// hiding it from both listings would make the engine read it as a deletion
	// on both sides and clear the row. Worse, hiding it from only one listing
	// would delete the real file on the other side. Adding a single exclude
	// pattern must never destroy the files it starts hiding.
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

	// After the directories, so a one-way job drops the folder work on the
	// protected side too, and before the unsupported report, which is a report
	// about both sides regardless of which one may be written.
	plan.Enforce(p, compare.Direction)

	// Whatever the backend refuses to carry has to be said out loud. rclone
	// drops symlinks and special files from its listing after a single log
	// line, so without this the user would be told the folder is in sync while
	// part of it was never looked at.
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

// foldCase decides whether names are matched case-insensitively.
//
// It is one answer for the whole job, not one per side. If only the
// case-insensitive end folded, the case-sensitive end's "Bild.jpg" and
// "bild.jpg" would both match the single file over there, and the engine would
// copy them over each other on every run without ever settling.
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

// canHoldEmptyDirs reports whether both ends have real directories.
//
// A bucket backend such as S3 does not: what looks like a folder there is a
// shared prefix on the keys, and it exists exactly as long as some key uses it.
// Trying to create one would succeed and then vanish, so the job would report
// making the same folder on every single run.
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

// NothingToSyncError says a job's sides do not exist.
//
// This is almost always a typo, a share that is not mounted, or a removable
// drive that is not attached. The alternative to saying so is reporting a
// successful run of zero files, which is how somebody comes to believe in a
// backup that has never happened.
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
// The cheap conditions are checked first and the question is only actually
// asked in the one case that warrants it. A job with anything in its record is
// left alone: that is the ordinary empty-side case and plan.Build refuses it
// with a better message, because a side that used to hold files and now holds
// none is a different and more alarming thing than a side that never existed.
//
// When both sides do look empty, each is asked outright whether it is there,
// rather than the reason being guessed from what the listing did not contain. A
// folder holding nothing but symbolic links, or nothing but files the job
// excludes, lists no files and exists perfectly well, and telling its owner to
// go and check whether their path exists would send them looking in the wrong
// place entirely.
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
