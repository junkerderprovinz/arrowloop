// Package engine is the one path a sync run takes.
//
// It exists so that the command line and the tests cannot drift apart. A test
// that assembles the stages itself would eventually prove that a sequence
// nobody ships works correctly, which is worse than no test at all.
package engine

import (
	"context"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/reeveroll/internal/apply"
	"github.com/junkerderprovinz/reeveroll/internal/filter"
	"github.com/junkerderprovinz/reeveroll/internal/plan"
	"github.com/junkerderprovinz/reeveroll/internal/scan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

// Options is everything a run needs beyond the two ends and the record.
type Options struct {
	Compare plan.Options
	Exclude *filter.Set

	// ForceFoldCase overrides what the backends report about case sensitivity.
	// Only the tests need it: the real answer comes from the filesystems.
	ForceFoldCase *bool
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

	scanOpt := scan.Options{FoldCase: compare.FoldCase, Exclude: opt.Exclude}
	left, err := scan.List(ctx, ends.Left, scanOpt)
	if err != nil {
		return nil, compare, err
	}
	right, err := scan.List(ctx, ends.Right, scanOpt)
	if err != nil {
		return nil, compare, err
	}

	p, err := plan.Build(ctx, left, right, visible, compare)
	return p, compare, err
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

// Execute carries out a plan that Prepare produced.
func Execute(ctx context.Context, ends apply.Ends, db *state.DB, p *plan.Plan, compare plan.Options) (apply.Result, error) {
	return apply.Run(ctx, ends, db, p, compare)
}

// Once prepares and executes in a single call.
func Once(ctx context.Context, ends apply.Ends, db *state.DB, opt Options) (*plan.Plan, apply.Result, error) {
	p, compare, err := Prepare(ctx, ends, db, opt)
	if err != nil {
		return nil, apply.Result{}, err
	}
	res, err := Execute(ctx, ends, db, p, compare)
	return p, res, err
}
