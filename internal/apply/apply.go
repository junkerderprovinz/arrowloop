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
	"sync"
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
	Copied      int
	Moved       int
	Trashed     int
	Conflicts   int
	DirsMade    int
	DirsRemoved int
	Skipped     []plan.Skip
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

// tally collects what a run did. Several workers report into it at once, so
// every field goes through the mutex.
type tally struct {
	mu    sync.Mutex
	res   Result
	fatal error
}

func (t *tally) count(f func(*Result)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	f(&t.res)
}

func (t *tally) skip(path, reason string) {
	t.count(func(r *Result) { r.Skipped = append(r.Skipped, plan.Skip{Path: path, Reason: reason}) })
}

func (t *tally) setFatal(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.fatal == nil {
		t.fatal = err
	}
}

func (t *tally) fatalErr() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.fatal
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
//
// The order is not decoration. Directories are created before anything is
// copied into them and removed after everything has been taken out of them,
// renames run before copies so a freed name is available, and deletions come
// last so a file is never removed before its replacement has landed.
func Run(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options) (Result, error) {
	t := &tally{res: Result{Skipped: append([]plan.Skip(nil), p.Skipped...)}}
	runID := time.Now().UTC().Format("20060102-150405")
	rec := recorder{ends: ends, db: db, window: opt.ModWindow}

	for _, d := range p.Dirs {
		if d.Kind == plan.RemoveDir {
			continue
		}
		if err := applyDir(ctx, ends, db, d); err != nil {
			t.skip(d.Path, fmt.Sprintf("%s failed, leaving it for the next run: %v", d.Kind, err))
			continue
		}
		if d.Kind == plan.MakeDir {
			t.count(func(r *Result) { r.DirsMade++ })
		}
	}

	// Renames stay sequential. Two of them in flight can chase each other
	// through the same name, and folding a rename into a single move is cheap
	// anyway, so there is nothing to gain by racing them.
	for _, act := range p.Actions {
		if act.Kind != plan.Move {
			continue
		}
		if err := one(ctx, ends, rec, act, runID, opt, t); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return t.res, err
			}
			t.skip(act.Path, fmt.Sprintf("move failed, leaving it for the next run: %v", err))
		}
	}

	for _, group := range [][]plan.Kind{{plan.Copy, plan.Conflict}, {plan.Delete}} {
		acts := ofKind(p.Actions, group...)
		if err := t.forEach(ctx, acts, opt.Transfers, func(ctx context.Context, act plan.Action) error {
			if why, busy := heldOpen(ends, act); busy {
				t.skip(act.Path, why)
				return nil
			}
			return one(ctx, ends, rec, act, runID, opt, t)
		}); err != nil {
			return t.res, err
		}
	}

	// Files both sides created identically need no transfer, only a record.
	for _, act := range p.Agreed {
		left, right := act.Names()
		if err := rec.settle(ctx, act.Path, left, right); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return t.res, err
			}
			t.skip(act.Path, err.Error())
		}
	}

	// Removals last, deepest first, so a parent is only tried once its children
	// are gone.
	for _, d := range p.Dirs {
		if d.Kind != plan.RemoveDir {
			continue
		}
		if err := applyDir(ctx, ends, db, d); err != nil {
			t.skip(d.Path, fmt.Sprintf("could not remove the folder, leaving it: %v", err))
			continue
		}
		t.count(func(r *Result) { r.DirsRemoved++ })
	}

	return t.res, t.fatalErr()
}

// forEach runs the actions concurrently, up to workers at a time.
//
// A failure on one file becomes a skip and the others carry on. A disagreement
// is different: it says the engine's picture of the tree is wrong, so the
// context is cancelled and the whole run stops rather than taking further
// decisions on a false basis.
func (t *tally) forEach(ctx context.Context, acts []plan.Action, workers int, fn func(context.Context, plan.Action) error) error {
	if len(acts) == 0 {
		return nil
	}
	if workers < 1 {
		workers = 1
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	ch := make(chan plan.Action)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for act := range ch {
				if err := fn(ctx, act); err != nil {
					var dis *DisagreementError
					if errors.As(err, &dis) {
						t.setFatal(err)
						cancel()
						return
					}
					t.skip(act.Path, fmt.Sprintf("%s failed, leaving it for the next run: %v", act.Kind, err))
				}
			}
		}()
	}

feed:
	for _, act := range acts {
		select {
		case ch <- act:
		case <-ctx.Done():
			break feed
		}
	}
	close(ch)
	wg.Wait()
	return t.fatalErr()
}

func ofKind(acts []plan.Action, kinds ...plan.Kind) []plan.Action {
	var out []plan.Action
	for _, a := range acts {
		if contains(kinds, a.Kind) {
			out = append(out, a)
		}
	}
	return out
}

// applyDir creates, removes or merely records one directory.
//
// Removal goes through Rmdir, which refuses a directory that still holds
// anything. That refusal is the safety property: a recursive delete here would
// take out files the engine had decided to keep, for instance ones it had just
// postponed because they were still being written.
func applyDir(ctx context.Context, ends Ends, db *state.DB, d plan.DirAction) error {
	switch d.Kind {
	case plan.MakeDir:
		if err := ends.side(d.Dst).Mkdir(ctx, d.DstPath); err != nil {
			return err
		}
		return db.PutDir(ctx, state.Dir{Path: d.Path, LeftPath: d.LeftPath, RightPath: d.RightPath, AgreedAt: time.Now().UTC()})
	case plan.RecordDir:
		return db.PutDir(ctx, state.Dir{Path: d.Path, LeftPath: d.LeftPath, RightPath: d.RightPath, AgreedAt: time.Now().UTC()})
	case plan.RemoveDir:
		if d.DstPath == "" {
			return db.ForgetDir(ctx, d.Path)
		}
		if err := ends.side(d.Dst).Rmdir(ctx, d.DstPath); err != nil {
			return err
		}
		return db.ForgetDir(ctx, d.Path)
	}
	return fmt.Errorf("unknown directory action %v", d.Kind)
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
//
// filepath.Join is doing more work here than it looks. On Windows rclone makes
// every local root an extended-length path so that names over 260 characters
// work, and Root() returns that prefix with forward slashes, as "//?/C:/...".
// Join cleans it back into the backslash form Win32 accepts. Concatenating the
// two strings by hand instead would produce a path the operating system
// refuses, and only for the deeply nested files this exists to support.
func localPath(f fs.Fs, remote string) (string, bool) {
	if f == nil || f.Name() != "local" {
		return "", false
	}
	return filepath.Join(f.Root(), filepath.FromSlash(remote)), true
}

func one(ctx context.Context, ends Ends, rec recorder, act plan.Action, runID string, opt plan.Options, t *tally) error {
	switch act.Kind {
	case plan.Copy:
		src, dst := ends.side(act.Src), ends.side(act.Dst)
		if err := operations.CopyFile(ctx, dst, src, act.DstPath, act.SrcPath); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Copied++ })
		left, right := act.Names()
		return rec.settle(ctx, act.Path, left, right)

	case plan.Move:
		dst := ends.side(act.Dst)
		if err := operations.MoveFile(ctx, dst, dst, act.DstPath, act.OldDstPath); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Moved++ })
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
		t.count(func(r *Result) { r.Trashed++ })
		return rec.db.Forget(ctx, act.Path)

	case plan.Conflict:
		t.count(func(r *Result) { r.Conflicts++ })
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
	steps, err := conflictSteps(ends, act, runID)
	if err != nil {
		return err
	}
	for _, s := range steps {
		if err := s.do(ctx); err != nil {
			return fmt.Errorf("%s: %w", s.what, err)
		}
	}

	last := steps[len(steps)-1]
	if err := rec.settle(ctx, act.Path, last.plainName, last.plainName); err != nil {
		return err
	}
	return rec.settle(ctx, pathid.Key(last.losingName, opt.FoldCase), last.losingName, last.losingName)
}

// conflictStep is one filesystem operation of a conflict resolution, named so
// that a failure can say which half of the manoeuvre it died in.
type conflictStep struct {
	what string
	do   func(context.Context) error

	plainName  string
	losingName string
}

// conflictSteps builds the resolution as an ordered list, because a run can die
// between any two of them and every prefix has to leave a tree the next run can
// recover from unaided.
//
// It does, and NOT because of anything clever here: the recovery comes from the
// decision table. A crash after the first step leaves the losing side without
// the plain name while the winning side still holds its edited copy, which is
// exactly the "deleted on one side, edited on the other" row, and that row
// restores the file rather than propagating the deletion. The manoeuvre is safe
// because that rule exists, which is worth writing down, since it means
// reordering these steps to make them "safer" is solving a problem the engine
// already solved.
//
// That was tried. Copying the losing version across BEFORE setting it aside
// looks stronger, since its content then exists in two places from the first
// step onwards. The crash test passes either way, and the earlier-copy order is
// measurably worse: it leaves the plain name contested, so recovery costs an
// extra round and an extra conflict copy. The order below converges in one.
func conflictSteps(ends Ends, act plan.Action, runID string) ([]conflictStep, error) {
	if act.LeftNow == nil || act.RightNow == nil {
		return nil, fmt.Errorf("conflict without both sides present")
	}

	winner, loser := plan.Left, plan.Right
	winnerPath, loserPath := act.LeftNow.Path, act.RightNow.Path
	if act.RightNow.Mod.After(act.LeftNow.Mod) {
		winner, loser = plan.Right, plan.Left
		winnerPath, loserPath = act.RightNow.Path, act.LeftNow.Path
	}
	winnerFs, loserFs := ends.side(winner), ends.side(loser)
	losing := conflictName(loserPath, loser, runID)

	step := func(what string, fn func(context.Context) error) conflictStep {
		return conflictStep{what: what, do: fn, plainName: winnerPath, losingName: losing}
	}

	return []conflictStep{
		// 1. Set the losing version aside on its own side. This frees the plain
		//    name, which matters when the two sides spell it differently:
		//    leaving both spellings behind would manufacture a name collision.
		step(fmt.Sprintf("set the %s version aside", loser), func(ctx context.Context) error {
			return operations.MoveFile(ctx, loserFs, loserFs, losing, loserPath)
		}),
		// 2. Give the other side a copy of it, so neither version lives on one
		//    side only.
		step(fmt.Sprintf("copy the %s version to the %s side", loser, winner), func(ctx context.Context) error {
			return operations.CopyFile(ctx, winnerFs, loserFs, losing, losing)
		}),
		// 3. The surviving version fills the plain name on both sides.
		step(fmt.Sprintf("copy the %s version to the %s side", winner, loser), func(ctx context.Context) error {
			return operations.CopyFile(ctx, loserFs, winnerFs, winnerPath, winnerPath)
		}),
	}, nil
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
