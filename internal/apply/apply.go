// Package apply executes a plan and records the result.
//
// Two rules govern everything here. Nothing is ever destroyed outright: a
// deletion is a move into the side's own trash. And the state row for a path is
// written the moment that path is settled, not once at the end, so a run that
// dies halfway leaves a state that is incomplete but never wrong.
package apply

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/operations"

	"github.com/junkerderprovinz/reeveroll/internal/plan"
	"github.com/junkerderprovinz/reeveroll/internal/scan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

// Ends holds the two filesystems a job runs against.
type Ends struct {
	Left  fs.Fs
	Right fs.Fs
}

func (e Ends) side(s plan.Side) fs.Fs {
	if s == plan.Left {
		return e.Left
	}
	return e.Right
}

// Result counts what a run actually did.
type Result struct {
	Copied    int
	Moved     int
	Trashed   int
	Conflicts int
}

// Run executes every action in the plan.
//
// It stops at the first failure rather than pressing on. A sync engine that
// keeps going after an error finishes with a state database describing a tree
// that does not exist, and the next run then acts on that fiction.
func Run(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options) (Result, error) {
	var res Result
	runID := time.Now().UTC().Format("20060102-150405")
	rec := recorder{ends: ends, db: db, window: opt.ModWindow}

	// Moves first: a rename frees a path that a later copy may want to fill.
	for _, group := range [][]plan.Kind{{plan.Move}, {plan.Copy, plan.Conflict}, {plan.Delete}} {
		for _, act := range p.Actions {
			if !contains(group, act.Kind) {
				continue
			}
			if err := one(ctx, ends, rec, act, runID, &res); err != nil {
				return res, fmt.Errorf("%s %q: %w", act.Kind, act.Path, err)
			}
		}
	}

	// Files both sides created identically need no transfer, only a record.
	for _, act := range p.Agreed {
		if err := rec.settle(ctx, act.Path); err != nil {
			return res, fmt.Errorf("record %q: %w", act.Path, err)
		}
	}
	return res, nil
}

func one(ctx context.Context, ends Ends, rec recorder, act plan.Action, runID string, res *Result) error {
	switch act.Kind {
	case plan.Copy:
		src, dst := ends.side(act.Src), ends.side(act.Dst)
		if err := operations.CopyFile(ctx, dst, src, act.Path, act.Path); err != nil {
			return err
		}
		res.Copied++
		return rec.settle(ctx, act.Path)

	case plan.Move:
		dst := ends.side(act.Dst)
		if err := operations.MoveFile(ctx, dst, dst, act.Path, act.OldPath); err != nil {
			return err
		}
		res.Moved++
		if err := rec.db.Forget(ctx, act.OldPath); err != nil {
			return err
		}
		return rec.settle(ctx, act.Path)

	case plan.Delete:
		// A path gone from both sides destroys nothing; only the record goes.
		if act.LeftNow == nil && act.RightNow == nil {
			return rec.db.Forget(ctx, act.Path)
		}
		live := act.LeftNow
		if act.Dst == plan.Right {
			live = act.RightNow
		}
		if live == nil {
			return rec.db.Forget(ctx, act.Path)
		}
		if err := toTrash(ctx, ends.side(act.Dst), live.Object(), runID); err != nil {
			return err
		}
		res.Trashed++
		return rec.db.Forget(ctx, act.Path)

	case plan.Conflict:
		res.Conflicts++
		return resolveConflict(ctx, ends, rec, act, runID)
	}
	return fmt.Errorf("unknown action kind %v", act.Kind)
}

// toTrash moves an object into the side's own trash instead of removing it.
//
// The trash lives inside the synced tree but under a reserved prefix that the
// scanner skips, so it never travels to the other side. Putting it outside the
// tree instead would be cleaner in principle and unusable in practice: on an
// S3 bucket or an SFTP export there is often no "outside".
func toTrash(ctx context.Context, f fs.Fs, obj fs.Object, runID string) error {
	dst := path.Join(scan.TrashDir, runID, obj.Remote())
	return operations.MoveFile(ctx, f, f, dst, obj.Remote())
}

// resolveConflict keeps both versions and leaves the two sides identical.
//
// The newer file keeps the plain name on both sides and the older one is
// preserved next to it under a name that says where it came from. Deciding by
// modification time is arbitrary in the sense that it can pick the "wrong"
// file, but it is never destructive, and it converges: after the run both sides
// hold exactly the same two files, so the next run has nothing left to argue
// about. Refusing to resolve at all would look safer and would in fact leave
// the job permanently stuck, re-reporting the same conflict forever.
func resolveConflict(ctx context.Context, ends Ends, rec recorder, act plan.Action, runID string) error {
	if act.LeftNow == nil || act.RightNow == nil {
		return fmt.Errorf("conflict without both sides present")
	}

	winner, loser := plan.Left, plan.Right
	if act.RightNow.Mod.After(act.LeftNow.Mod) {
		winner, loser = plan.Right, plan.Left
	}
	winnerFs, loserFs := ends.side(winner), ends.side(loser)
	losing := conflictName(act.Path, loser, runID)

	// 1. Get the losing version out of the way, on its own side.
	if err := operations.MoveFile(ctx, loserFs, loserFs, losing, act.Path); err != nil {
		return fmt.Errorf("set aside the %s version: %w", loser, err)
	}
	// 2. Give the other side a copy of it, so nothing exists on one side only.
	if err := operations.CopyFile(ctx, winnerFs, loserFs, losing, losing); err != nil {
		return fmt.Errorf("copy the %s version across: %w", loser, err)
	}
	// 3. The surviving version fills the plain name on both sides.
	if err := operations.CopyFile(ctx, loserFs, winnerFs, act.Path, act.Path); err != nil {
		return fmt.Errorf("copy the %s version across: %w", winner, err)
	}

	if err := rec.settle(ctx, act.Path); err != nil {
		return err
	}
	return rec.settle(ctx, losing)
}

// conflictName builds the name the losing version is kept under. The timestamp
// makes repeated conflicts on the same file pile up instead of overwriting each
// other, which would defeat the point.
func conflictName(p string, side plan.Side, runID string) string {
	dir, base := path.Split(p)
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	return path.Join(dir, fmt.Sprintf("%s.conflict-%s-%s%s", stem, side, runID, ext))
}

// recorder writes state rows, and only for paths where both sides really do
// hold the same file.
type recorder struct {
	ends   Ends
	db     *state.DB
	window time.Duration
}

// settle re-reads a path on both sides and stores it as the new agreement.
//
// Re-reading costs one metadata call per side per file. It would be cheaper to
// assume the destination now matches the source, but that assumption is exactly
// where silent corruption hides: a backend that rounds modification times, or
// rewrites a name, would leave a state row describing something that is not
// there, and every later run would then re-copy the file forever.
//
// The equality check afterwards is the part that must never be dropped. A state
// row means "these two sides agree", and writing one for a pair that does not
// agree is how a sync tool stops noticing a difference: the next run compares
// both sides against a record that already matches them both, concludes nothing
// changed, and the divergence becomes permanent and invisible. Better to fail
// the run loudly here than to let the engine lie to itself.
func (r recorder) settle(ctx context.Context, rel string) error {
	left, lErr := r.ends.Left.NewObject(ctx, rel)
	right, rErr := r.ends.Right.NewObject(ctx, rel)
	if lErr != nil || rErr != nil {
		// One side is missing, so there is nothing the two sides agree on.
		return r.db.Forget(ctx, rel)
	}

	leftFacts := plan.Facts{Size: left.Size(), Mod: left.ModTime(ctx), Hash: hashOf(ctx, left)}
	rightFacts := plan.Facts{Size: right.Size(), Mod: right.ModTime(ctx), Hash: hashOf(ctx, right)}
	if !plan.Same(leftFacts, rightFacts, r.window) {
		return fmt.Errorf("refusing to record %q as agreed: left is %d bytes at %s, right is %d bytes at %s",
			rel, leftFacts.Size, leftFacts.Mod.UTC().Format(time.RFC3339Nano),
			rightFacts.Size, rightFacts.Mod.UTC().Format(time.RFC3339Nano))
	}

	return r.db.Put(ctx, state.Entry{
		Path:      rel,
		LeftSize:  leftFacts.Size,
		LeftMod:   leftFacts.Mod,
		LeftHash:  leftFacts.Hash,
		RightSize: rightFacts.Size,
		RightMod:  rightFacts.Mod,
		RightHash: rightFacts.Hash,
		AgreedAt:  time.Now().UTC(),
	})
}

func hashOf(ctx context.Context, obj fs.Object) string {
	sum, err := obj.Hash(ctx, hash.MD5)
	if err != nil {
		return ""
	}
	return sum
}

func contains(kinds []plan.Kind, k plan.Kind) bool {
	for _, want := range kinds {
		if want == k {
			return true
		}
	}
	return false
}
