// Package apply executes a plan and records the result.
//
// Two rules govern everything here. Nothing is ever destroyed outright: a
// deletion is a move into the side's own trash. And the state row for a path is
// written the moment that path is settled, not once at the end, so a run that
// dies halfway leaves a state that is incomplete but never wrong.
package apply

import (
	"context"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/operations"

	"github.com/junkerderprovinz/reeveroll/internal/lockprobe"
	"github.com/junkerderprovinz/reeveroll/internal/pathid"
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
	Skipped   []plan.Skip
}

// DisagreementError means an operation reported success and the two sides still
// do not hold the same file. It is fatal for the run, unlike an ordinary
// transfer failure, because it says the engine's picture of the world is wrong
// rather than that one file was busy.
type DisagreementError struct {
	Path    string
	Details string
}

func (e *DisagreementError) Error() string {
	return fmt.Sprintf("refusing to record %q as agreed: %s", e.Path, e.Details)
}

// Run executes every action in the plan.
//
// A single action that fails is recorded as a skip and the run carries on. That
// is safe precisely because a state row is only written after the operation
// succeeded AND both sides were re-read and found to match: a file that could
// not be copied keeps its old record, or none, so the next run tries again. The
// one thing that does stop the run is a disagreement, because that means the
// engine no longer understands the tree it is working on, and every further
// action would be taken on a false picture.
func Run(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options) (Result, error) {
	res := Result{Skipped: append([]plan.Skip(nil), p.Skipped...)}
	runID := time.Now().UTC().Format("20060102-150405")
	rec := recorder{ends: ends, db: db, window: opt.ModWindow}

	// Moves first: a rename frees a path that a later copy may want to fill.
	for _, group := range [][]plan.Kind{{plan.Move}, {plan.Copy, plan.Conflict}, {plan.Delete}} {
		for _, act := range p.Actions {
			if !contains(group, act.Kind) {
				continue
			}
			if why, busy := heldOpen(ends, act); busy {
				res.Skipped = append(res.Skipped, plan.Skip{Path: act.Path, Reason: why})
				continue
			}
			if err := one(ctx, ends, rec, act, runID, opt, &res); err != nil {
				var dis *DisagreementError
				if errors.As(err, &dis) {
					return res, err
				}
				res.Skipped = append(res.Skipped, plan.Skip{
					Path:   act.Path,
					Reason: fmt.Sprintf("%s failed, leaving it for the next run: %v", act.Kind, err),
				})
			}
		}
	}

	// Files both sides created identically need no transfer, only a record.
	for _, act := range p.Agreed {
		left, right := act.Names()
		if err := rec.settle(ctx, act.Path, left, right); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return res, err
			}
			res.Skipped = append(res.Skipped, plan.Skip{Path: act.Path, Reason: err.Error()})
		}
	}
	return res, nil
}

// heldOpen asks whether the file an action wants to read is locked by another
// program. Only the source of a transfer is probed: a destination that is
// locked fails loudly on its own, while a locked source is the everyday case of
// a document somebody left open.
func heldOpen(ends Ends, act plan.Action) (string, bool) {
	if act.Kind != plan.Copy || act.SrcPath == "" {
		return "", false
	}
	full, ok := localPath(ends.side(act.Src), act.SrcPath)
	if !ok || !lockprobe.Busy(full) {
		return "", false
	}
	return fmt.Sprintf("held open by another program on the %s side, waiting for it to be closed", act.Src), true
}

// localPath maps an rclone object back to a real filesystem path, when there is
// one. Anything that is not the local backend has no such path, and the probe
// simply does not apply.
func localPath(f fs.Fs, remote string) (string, bool) {
	if f == nil || f.Name() != "local" {
		return "", false
	}
	return filepath.Join(f.Root(), filepath.FromSlash(remote)), true
}

func one(ctx context.Context, ends Ends, rec recorder, act plan.Action, runID string, opt plan.Options, res *Result) error {
	switch act.Kind {
	case plan.Copy:
		src, dst := ends.side(act.Src), ends.side(act.Dst)
		if err := operations.CopyFile(ctx, dst, src, act.DstPath, act.SrcPath); err != nil {
			return err
		}
		res.Copied++
		left, right := act.Names()
		return rec.settle(ctx, act.Path, left, right)

	case plan.Move:
		dst := ends.side(act.Dst)
		if err := operations.MoveFile(ctx, dst, dst, act.DstPath, act.OldDstPath); err != nil {
			return err
		}
		res.Moved++
		if err := rec.db.Forget(ctx, pathid.Key(act.OldDstPath, opt.FoldCase)); err != nil {
			return err
		}
		left, right := act.Names()
		return rec.settle(ctx, act.Path, left, right)

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
		return resolveConflict(ctx, ends, rec, act, runID, opt)
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
func resolveConflict(ctx context.Context, ends Ends, rec recorder, act plan.Action, runID string, opt plan.Options) error {
	if act.LeftNow == nil || act.RightNow == nil {
		return fmt.Errorf("conflict without both sides present")
	}

	winner, loser := plan.Left, plan.Right
	winnerPath, loserPath := act.LeftNow.Path, act.RightNow.Path
	if act.RightNow.Mod.After(act.LeftNow.Mod) {
		winner, loser = plan.Right, plan.Left
		winnerPath, loserPath = act.RightNow.Path, act.LeftNow.Path
	}
	winnerFs, loserFs := ends.side(winner), ends.side(loser)
	losing := conflictName(loserPath, loser, runID)

	// 1. Get the losing version out of the way, on its own side.
	if err := operations.MoveFile(ctx, loserFs, loserFs, losing, loserPath); err != nil {
		return fmt.Errorf("set aside the %s version: %w", loser, err)
	}
	// 2. Give the other side a copy of it, so nothing exists on one side only.
	if err := operations.CopyFile(ctx, winnerFs, loserFs, losing, losing); err != nil {
		return fmt.Errorf("copy the %s version across: %w", loser, err)
	}
	// 3. The surviving version fills the plain name on both sides.
	if err := operations.CopyFile(ctx, loserFs, winnerFs, winnerPath, winnerPath); err != nil {
		return fmt.Errorf("copy the %s version across: %w", winner, err)
	}

	if err := rec.settle(ctx, act.Path, winnerPath, winnerPath); err != nil {
		return err
	}
	return rec.settle(ctx, pathid.Key(losing, opt.FoldCase), losing, losing)
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
func (r recorder) settle(ctx context.Context, key, leftPath, rightPath string) error {
	left, lErr := r.ends.Left.NewObject(ctx, leftPath)
	right, rErr := r.ends.Right.NewObject(ctx, rightPath)
	if lErr != nil || rErr != nil {
		// One side is missing, so there is nothing the two sides agree on.
		return r.db.Forget(ctx, key)
	}

	leftFacts := plan.Facts{Size: left.Size(), Mod: left.ModTime(ctx), Hash: hashOf(ctx, left)}
	rightFacts := plan.Facts{Size: right.Size(), Mod: right.ModTime(ctx), Hash: hashOf(ctx, right)}
	if !plan.Same(leftFacts, rightFacts, r.window) {
		return &DisagreementError{
			Path: key,
			Details: fmt.Sprintf("left %q is %d bytes at %s, right %q is %d bytes at %s",
				leftPath, leftFacts.Size, leftFacts.Mod.UTC().Format(time.RFC3339Nano),
				rightPath, rightFacts.Size, rightFacts.Mod.UTC().Format(time.RFC3339Nano)),
		}
	}

	return r.db.Put(ctx, state.Entry{
		Path:      key,
		LeftPath:  leftPath,
		RightPath: rightPath,
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
