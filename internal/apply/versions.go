package apply

import (
	"context"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/trash"
)

// Keeping the last few versions of a file that is only ever edited.
//
// The two dramatic cases already leave something behind. A deletion is a move
// into the trash, and a conflict keeps the losing version beside the winner under
// a name that says where it came from. The undramatic case leaves nothing: a
// document edited on one side and copied over the other side's copy on every run
// has no history at all, and that is the case where somebody actually wants
// yesterday's file back.
//
// The copy is put in the same reserved directory the trash lives in, through the
// same move that toTrash uses, and not through a second mechanism. That one
// property, that internal/scan skips everything under the reserved prefix on both
// sides, is what makes a copy safe to leave inside the tree: it never syncs, it
// never returns as a file somebody created, and it works on a bucket where there
// is no outside the tree to put anything in. A second mechanism would have to
// earn that property again and would eventually fail to.

// versionsKey is how the setting travels, and it is a context key rather than a
// field for a reason that has already bitten this program once.
//
// The obvious alternatives are both worse. A package-level variable would be
// shared by every job in the process, and parallelJobs is a real setting: two
// jobs with different answers running at the same time would take each other's.
// A field on plan.Options would put this in front of every caller that builds a
// plan and never applies one, and the planner has no use for it, which is the
// same argument RunVerified already makes about Verify.
//
// The context is where this program already carries per-job settings: see
// engine.Configure, which copies rclone's own configuration into the context so
// that one job asking for eight transfers does not quietly change another's. This
// is that pattern and not a new one.
type versionsKey struct{}

// WithVersions says how many old copies of an overwritten file this run keeps.
//
// Anything below one is off, which is the default and has to be. Keeping
// versions doubles what a busy tree holds, silently, inside the tree itself,
// and a sync tool that started eating disk space on an upgrade would be a sync
// tool nobody upgrades again. It is a decision somebody makes about a particular
// job, knowing what that job's files are worth.
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

// keepVersion sets aside whatever is about to be overwritten at remote.
//
// Called immediately before the copy that replaces it, and its error must reach
// the caller rather than being logged and stepped over. Somebody who asked for
// the last three versions of their files, and got an overwrite instead because
// setting the old one aside quietly failed, has been handed the exact outcome the
// setting exists to prevent. Returned as an error it becomes a skip with a reason
// and the next run tries the same file again, which is the right thing to happen
// to a file whose old version could not be saved.
//
// It is a no-op, with not a single call to the backend, when the setting is off.
// A run over ten thousand unchanged files must not make ten thousand metadata
// requests to support a feature nobody switched on.
//
// Only the overwrite is hooked. A conflict already keeps both versions, by name
// or in the trash, so versioning it as well would file the same bytes twice. A
// rename moves a file to a name the planner only proposes when it is free, so
// there is nothing under it to keep.
func keepVersion(ctx context.Context, f fs.Fs, remote, runID string) error {
	return trash.KeepVersion(ctx, f, remote, runID, versionsKept(ctx))
}
