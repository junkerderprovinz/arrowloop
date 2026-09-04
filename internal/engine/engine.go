// Package engine is the one path a sync run takes.
//
// It exists so that the command line and the tests cannot drift apart. A test
// that assembles the stages itself would eventually prove that a sequence
// nobody ships works correctly, which is worse than no test at all.
package engine

import (
	"context"

	"github.com/junkerderprovinz/reeveroll/internal/apply"
	"github.com/junkerderprovinz/reeveroll/internal/plan"
	"github.com/junkerderprovinz/reeveroll/internal/scan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

// Prepare lists both sides and works out what needs to happen. It changes
// nothing, so its result is safe to show to a user and to measure the safety
// brakes against.
func Prepare(ctx context.Context, ends apply.Ends, db *state.DB, opt plan.Options) (*plan.Plan, error) {
	prev, err := db.All(ctx)
	if err != nil {
		return nil, err
	}
	left, err := scan.List(ctx, ends.Left)
	if err != nil {
		return nil, err
	}
	right, err := scan.List(ctx, ends.Right)
	if err != nil {
		return nil, err
	}
	return plan.Build(ctx, left, right, prev, opt)
}

// Execute carries out a plan that Prepare produced.
func Execute(ctx context.Context, ends apply.Ends, db *state.DB, p *plan.Plan, opt plan.Options) (apply.Result, error) {
	return apply.Run(ctx, ends, db, p, opt)
}

// Once prepares and executes in a single call.
func Once(ctx context.Context, ends apply.Ends, db *state.DB, opt plan.Options) (*plan.Plan, apply.Result, error) {
	p, err := Prepare(ctx, ends, db, opt)
	if err != nil {
		return nil, apply.Result{}, err
	}
	res, err := Execute(ctx, ends, db, p, opt)
	return p, res, err
}
