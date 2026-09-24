package apply

import (
	"context"
	"errors"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/shadow"
)

// Snapshots shows a local directory as a snapshot of its volume has it, so a
// file another program holds open can still be read. shadow.Set is the one
// the program uses.
type Snapshots interface {
	Root(ctx context.Context, dir string) (string, error)
}

type snapshotsKey struct{}

// WithSnapshots lets a run copy a file held open from a snapshot instead of
// postponing it.
func WithSnapshots(ctx context.Context, s Snapshots) context.Context {
	return context.WithValue(ctx, snapshotsKey{}, s)
}

var errNoSnapshot = errors.New("no snapshot for this action")

// fromSnapshot is ends with the source of a copy read from a snapshot. Only a
// plain copy qualifies: moving a file away or resolving a conflict has to
// change the file itself, which a snapshot cannot. The source's record is
// settled against the snapshot too, so a file that went on changing is copied
// again by the next run instead of failing this one.
func fromSnapshot(ctx context.Context, ends Ends, act plan.Action) (Ends, error) {
	s, _ := ctx.Value(snapshotsKey{}).(Snapshots)
	if s == nil || act.Kind != plan.Copy {
		return Ends{}, errNoSnapshot
	}
	root, ok := localPath(ends.side(act.Src), "")
	if !ok {
		return Ends{}, errNoSnapshot
	}
	frozen, err := s.Root(ctx, root)
	if err != nil {
		return Ends{}, err
	}
	f, err := fs.NewFs(ctx, frozen)
	if err != nil {
		return Ends{}, err
	}
	if act.Src == plan.Left {
		ends.Left = f
	} else {
		ends.Right = f
	}
	return ends, nil
}

// copyHeldOpen copies a file whose source another program holds open from a
// snapshot, and otherwise records why it was postponed.
func copyHeldOpen(ctx context.Context, ends Ends, rec recorder, act plan.Action, why plan.Reason, runID string, opt plan.Options, t *tally) error {
	frozen, err := fromSnapshot(ctx, ends, act)
	switch {
	case err == nil:
		rec.ends = frozen
		return one(ctx, frozen, rec, act, runID, opt, t)
	case errors.Is(err, errNoSnapshot):
	case errors.Is(err, shadow.ErrNeedsAdmin):
		why = plan.Because("heldOpenAdmin", "side", act.Src.String())
	default:
		why = plan.Because("snapshotFailed", "side", act.Src.String(), "error", err.Error())
	}
	t.skip(act.Path, "", why)
	return nil
}
