package scan

import "context"

// Stage names a part of reading a job, before any file moves.
type Stage string

// The stages in the order a run passes them: each side is listed, a local side
// is walked again for links the listing leaves out, then the sides are compared.
const (
	StageList    Stage = "list"
	StageCheck   Stage = "check"
	StageCompare Stage = "compare"
)

// Reading is how far one stage has got. Total is zero when nothing hints at
// it; Guess says it comes from the last run rather than from this one.
type Reading struct {
	Stage Stage
	Side  string
	Done  int
	Total int
	Guess bool
}

// Watch hears how reading a job is going. Walking a large share can take many
// minutes, and without this a job looks hung until the first file moves.
type Watch func(Reading)

type watchKey struct{}

// WithWatch returns a context whose reading stages report to w.
func WithWatch(ctx context.Context, w Watch) context.Context {
	return context.WithValue(ctx, watchKey{}, w)
}

// ForSide labels what the walks of one side report, and gives them a total to
// measure against when they have none of their own.
func ForSide(ctx context.Context, side string, total int, guess bool) context.Context {
	w, ok := ctx.Value(watchKey{}).(Watch)
	if !ok {
		return ctx
	}
	return WithWatch(ctx, func(r Reading) {
		r.Side = side
		if r.Total == 0 {
			r.Total, r.Guess = total, guess
		}
		w(r)
	})
}

// Report passes r to the context's watcher, if it has one.
func Report(ctx context.Context, r Reading) {
	if w, ok := ctx.Value(watchKey{}).(Watch); ok {
		w(r)
	}
}
