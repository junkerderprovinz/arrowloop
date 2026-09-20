package apply

import (
	"context"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/trash"
)

// versionsKey carries the number of versions to keep in the context, where the
// program keeps its per-job settings (see engine.Configure). A package variable
// would be shared by jobs running at once, and the planner has no use for it in
// plan.Options.
type versionsKey struct{}

// WithVersions says how many old copies of an overwritten file this run keeps.
// Anything below one is off, which is the default, since keeping versions can
// double what a busy tree holds.
func WithVersions(ctx context.Context, keep int) context.Context {
	return context.WithValue(ctx, versionsKey{}, keep)
}

// versionsKept reads the setting back, answering zero when nobody set it.
func versionsKept(ctx context.Context) int {
	keep, ok := ctx.Value(versionsKey{}).(int)
	if !ok {
		return 0
	}
	return keep
}

// keepVersion sets aside whatever is about to be overwritten at remote, under
// the reserved directory the trash uses, which the scanner skips on both sides.
//
// Its error reaches the caller, so an overwrite never happens without the old
// version being kept; the file becomes a skip and the next run tries again.
// With the setting off it makes no backend calls. Only overwrites are hooked: a
// conflict already keeps both versions, and a rename only targets a free name.
func keepVersion(ctx context.Context, f fs.Fs, remote, runID string) error {
	return trash.KeepVersion(ctx, f, remote, runID, versionsKept(ctx))
}

// trashKey carries whether this job keeps a trash, for the same reasons as
// versionsKey.
type trashKey struct{}

// WithTrash says whether deletions on this run go to the side's own trash.
func WithTrash(ctx context.Context, keep bool) context.Context {
	return context.WithValue(ctx, trashKey{}, keep)
}

// trashKept reads the setting back, and answers true when nobody set it, so a
// caller that forgot to say never deletes files outright.
func trashKept(ctx context.Context) bool {
	keep, ok := ctx.Value(trashKey{}).(bool)
	if !ok {
		return true
	}
	return keep
}
