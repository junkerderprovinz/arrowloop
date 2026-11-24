package apply

import (
	"context"
	"fmt"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// TrashRefusedError means a side would not take the folder its trash and old
// versions go in, so the run stopped before it changed anything.
type TrashRefusedError struct {
	Side plan.Side
	Err  error
}

func (e *TrashRefusedError) Error() string {
	return fmt.Sprintf("the trash cannot be kept on the %s side: it does not let ArrowLoop create its %s folder at the top, where the trash and old versions go, so the run stopped before it changed anything. If this job may delete there outright, switch off its trash, and kept versions if it keeps any: %v",
		e.Side, scan.MetaDir, e.Err)
}

func (e *TrashRefusedError) Unwrap() error { return e.Err }

// settingAside says on which sides the plan puts a file into the trash or keeps
// an old version, the two things that need the reserved folder.
func settingAside(ctx context.Context, p *plan.Plan) map[plan.Side]bool {
	trash, versions := trashKept(ctx), versionsKept(ctx) > 0
	on := map[plan.Side]bool{}
	for _, act := range p.Actions {
		there := act.LeftNow
		if act.Dst == plan.Right {
			there = act.RightNow
		}
		switch act.Kind {
		case plan.Delete:
			on[act.Dst] = on[act.Dst] || trash && there != nil
		case plan.Copy:
			on[act.Dst] = on[act.Dst] || versions && there != nil
		case plan.Relocate:
			sent := act.RightNow
			if act.Dst == plan.Right {
				sent = act.LeftNow
			}
			on[act.Src] = on[act.Src] || trash && sent != nil
			on[act.Dst] = on[act.Dst] || versions && there != nil && !act.Aside
		case plan.Conflict:
			loser := plan.Right
			if act.Resolve == plan.KeepRight {
				loser = plan.Left
			}
			on[loser] = on[loser] || trash && act.Resolve != plan.KeepBoth
		}
	}
	return on
}

// roomToSetAside makes sure the reserved folder is on every side in on, so a
// side that refuses it stops the run before the first change instead of
// failing each deletion on it. The folder is looked for before it is made,
// since every run but the first finds it there.
func roomToSetAside(ctx context.Context, ends Ends, on map[plan.Side]bool) error {
	for _, side := range []plan.Side{plan.Left, plan.Right} {
		if !on[side] {
			continue
		}
		f := ends.side(side)
		// Both callers have just reached the side, so a folder that cannot be
		// listed is one that is not there.
		if _, err := f.List(ctx, scan.MetaDir); err == nil {
			continue
		}
		if err := f.Mkdir(ctx, scan.MetaDir); err != nil {
			return &TrashRefusedError{Side: side, Err: err}
		}
	}
	return nil
}
