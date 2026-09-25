// Package apply executes a plan and records the result.
//
// A deletion is a move into the side's own trash unless the job is configured
// without one. The state row for a path is written the moment that path is
// settled, so a run that dies halfway leaves a state that is incomplete but
// never wrong.
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
	"github.com/rclone/rclone/fs/fserrors"
	"github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/operations"

	"github.com/junkerderprovinz/arrowloop/internal/lockprobe"
	"github.com/junkerderprovinz/arrowloop/internal/pathid"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// Progress is told what a run is doing while it does it. Implementations are
// called from several workers at once. A nil Progress means nobody is watching.
type Progress interface {
	Starting(total int)
	Did(kind, path, side string, done, total int)
}

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

	// Entries is what the run did, path by path, in the order it finished each
	// piece of work, so the log can say which file failed and how a conflict
	// was decided.
	Entries []Entry
}

// Entry is one finished piece of work.
type Entry struct {
	Kind string
	Side string
	Path string
	// Note is an error's own words, or which way a conflict went. Empty for
	// the ordinary case.
	Note string
	// Size is how big the file was, in bytes. Zero for a folder, a skip and an
	// error, where it does not apply.
	Size int64
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

// UnverifiedError means the two sides looked equal and the engine could not
// prove it, on a job that asked for proof. It does not stop the run: the file
// is across and only its state row is withheld, so the next run compares again.
type UnverifiedError struct {
	Path string
	Side plan.Side
	// Err is what the backend said when asked for a checksum, which tells "this
	// backend has no checksums" from "this file could not be read".
	Err error
}

func (e *UnverifiedError) Error() string {
	return fmt.Sprintf("not recording %q as agreed: the %s side could not produce a checksum: %v", e.Path, e.Side, e.Err)
}

func (e *UnverifiedError) Unwrap() error { return e.Err }

// Verify says how much proof a run demands before it writes down that two sides
// hold the same file. The zero value compares checksums where both sides can
// produce them and falls back to size and modification time where they cannot.
type Verify struct {
	// RequireChecksum refuses to record an agreement that rests on size and
	// modification time alone. It is off by default because some backends
	// cannot hash at all, such as SFTP without a remote shell, and a job across
	// one would then reconsider every file on every run.
	RequireChecksum bool
}

// tally collects what a run did. Several workers report into it at once, so
// every field goes through the mutex.
type tally struct {
	mu    sync.Mutex
	res   Result
	fatal error

	progress Progress
	total    int
	done     int
}

// step reports one finished piece of work.
func (t *tally) step(kind, path, side string) {
	t.note(kind, path, side, "")
}

// sized is step for a piece of work that moved a known number of bytes.
func (t *tally) sized(kind, path, side string, size int64) {
	t.mu.Lock()
	t.done++
	t.record(Entry{Kind: kind, Side: side, Path: path, Size: size})
	done, total, watcher := t.done, t.total, t.progress
	t.mu.Unlock()
	if watcher != nil {
		watcher.Did(kind, path, side, done, total)
	}
}

// spelled is an action's file as a side that holds it spells it. The path is
// the key both sides are matched on, folded to lower case wherever a side
// ignores case, and the log is read by people.
func spelled(act plan.Action) string {
	if act.LeftNow != nil {
		return act.LeftNow.Path
	}
	if act.RightNow != nil {
		return act.RightNow.Path
	}
	return act.Path
}

// sizeOf is the size of whichever side an action is acting on, or zero when
// there is nothing there to measure.
func sizeOf(e *scan.Entry) int64 {
	if e == nil {
		return 0
	}
	return e.Size
}

// note is step with something to say about this piece of work: the words of an
// error, or which way a conflict went. The entry and the count are taken under
// one lock, so the numbers a watcher sees add up.
func (t *tally) note(kind, path, side, note string) {
	t.mu.Lock()
	t.done++
	t.record(Entry{Kind: kind, Side: side, Path: path, Note: note})
	done, total, watcher := t.done, t.total, t.progress
	t.mu.Unlock()
	if watcher != nil {
		watcher.Did(kind, path, side, done, total)
	}
}

// observe records something about one file that is not a piece of work, such
// as why a check was weaker than usual. Like skip, it does not go through note,
// which would walk the progress bar past the total countWork worked out.
func (t *tally) observe(kind, path, side, note string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.record(Entry{Kind: kind, Side: side, Path: path, Note: note})
}

// record appends one line to the run's list. The caller holds the mutex, so
// that a count and its line are always taken together.
func (t *tally) record(e Entry) { t.res.Entries = append(t.res.Entries, e) }

// countWork is what the plan is going to touch, worked out before anything
// moves so the progress total does not grow.
func countWork(p *plan.Plan) int {
	n := len(p.Agreed)
	for _, a := range p.Actions {
		n++
		// A Relocate reports two steps: the copy, and the source going.
		if a.Kind == plan.Relocate {
			n++
		}
	}
	for _, d := range p.Dirs {
		if d.Kind != plan.RecordDir && d.DstPath != "" {
			n++
		}
	}
	return n
}

func (t *tally) count(f func(*Result)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	f(&t.res)
}

// skip records work that did not happen. side is the side a failed step was
// writing to, so the log can say an upload failed; a postponed file passes an
// empty side, since nothing was tried there.
func (t *tally) skip(path, side string, reason plan.Reason) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.res.Skipped = append(t.res.Skipped, plan.Skip{Path: path, Reason: reason})
	// Not through note: a skip is not finished work and must not move the
	// progress bar.
	t.record(Entry{Kind: "skip", Side: side, Path: path, Note: reason.String()})
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
// A single action that fails is recorded as a skip and the run carries on,
// which is safe because a state row is only written once both sides were
// re-read and found to match. A disagreement stops the run, because it means
// the engine's picture of the tree is wrong.
//
// Directories are created before anything is copied into them and removed
// after they are emptied, renames run before copies so a freed name is
// available, and deletions come last so a file is never removed before its
// replacement has landed.
func Run(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options) (Result, error) {
	return RunWatched(ctx, ends, db, p, opt, nil)
}

// RunWatched is Run with somebody looking over its shoulder.
func RunWatched(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options, watcher Progress) (Result, error) {
	return RunVerified(ctx, ends, db, p, opt, watcher, Verify{})
}

// RunVerified is RunWatched with the strength of the after-the-fact check
// spelled out. It is not part of plan.Options because the planner never uses
// it.
func RunVerified(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options, watcher Progress, verify Verify) (Result, error) {
	t := &tally{res: Result{Skipped: append([]plan.Skip(nil), p.Skipped...)}, progress: watcher}
	t.total = countWork(p)
	if watcher != nil {
		watcher.Starting(t.total)
	}
	runID := time.Now().UTC().Format("20060102-150405")
	rec := recorder{ends: ends, db: db, window: opt.ModWindow, verify: verify, observe: t.observe}

	for _, d := range p.Dirs {
		if d.Kind == plan.RemoveDir {
			continue
		}
		if err := applyDir(ctx, ends, db, d); err != nil {
			t.skip(d.Path, d.Dst.String(), whyFailed(ends, nil, d.Kind.String(), "stepFailed", err))
			continue
		}
		if d.Kind == plan.MakeDir {
			t.count(func(r *Result) { r.DirsMade++ })
			t.step("mkdir", d.DstPath, d.Dst.String())
		}
	}

	// Renames stay sequential, since two in flight can chase each other
	// through the same name.
	for _, act := range p.Actions {
		if act.Kind != plan.Move {
			continue
		}
		if why, busy := heldOpen(ends, act); busy {
			t.skip(act.Path, "", why)
			continue
		}
		if err := one(ctx, ends, rec, act, runID, opt, t); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return t.res, err
			}
			t.skip(act.Path, act.Dst.String(), whyFailed(ends, couldHaveLocked(act), "move", "stepFailed", err))
		}
	}

	for _, group := range [][]plan.Kind{{plan.Copy, plan.Relocate, plan.Conflict}, {plan.Delete}} {
		acts := ofKind(p.Actions, group...)
		if err := t.forEach(ctx, ends, acts, opt.Transfers, func(ctx context.Context, act plan.Action) error {
			if why, busy := heldOpen(ends, act); busy {
				return copyHeldOpen(ctx, ends, rec, act, why, runID, opt, t)
			}
			return one(ctx, ends, rec, act, runID, opt, t)
		}); err != nil {
			return t.res, err
		}
	}

	// Files both sides created identically need no transfer, only a record.
	for _, act := range p.Agreed {
		left, right := act.Names()
		// With its size although nothing was transferred, since on a settled
		// pair of trees these are nearly all the rows. Both sides agree, so
		// either will do.
		agreed := act.LeftNow
		if agreed == nil {
			agreed = act.RightNow
		}
		t.sized("record", spelled(act), "", sizeOf(agreed))
		if err := rec.settle(ctx, act.Path, left, right); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return t.res, err
			}
			t.skip(act.Path, "", whyFailed(ends, couldHaveLocked(act), "record", "recordFailed", err))
		}
	}

	// Removals last, deepest first, so a parent is only tried once its children
	// are gone.
	for _, d := range p.Dirs {
		if d.Kind != plan.RemoveDir {
			continue
		}
		if err := applyDir(ctx, ends, db, d); err != nil {
			t.skip(d.Path, d.Dst.String(), whyFailed(ends, nil, "removing the folder", "removeDirFailed", err))
			continue
		}
		t.count(func(r *Result) { r.DirsRemoved++ })
		t.step("rmdir", d.DstPath, d.Dst.String())
	}

	return t.res, t.fatalErr()
}

// forEach runs the actions concurrently, up to workers at a time. A failure on
// one file becomes a skip; a disagreement cancels the context and stops the
// run. The ends are only needed to classify a failure.
func (t *tally) forEach(ctx context.Context, ends Ends, acts []plan.Action, workers int, fn func(context.Context, plan.Action) error) error {
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
					t.skip(act.Path, act.Dst.String(), whyFailed(ends, couldHaveLocked(act), act.Kind.String(), "stepFailed", err))
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

// applyDir creates, removes or merely records one directory. Removal goes
// through Rmdir, which refuses a directory that still holds anything, such as
// a file postponed because it was still being written.
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

// heldOpen asks whether any file this action has to get at is locked by another
// program, before the action is attempted, so the run can name the remedy
// rather than report a raw Win32 sentence. The destination of a copy is only
// probed after a failure; see couldHaveLocked.
func heldOpen(ends Ends, act plan.Action) (plan.Reason, bool) {
	for _, w := range wantsToTouch(act) {
		full, ok := localPath(ends.side(w.side), w.path)
		if ok && lockprobe.Busy(full) {
			return plan.Because("heldOpen", "side", w.side.String()), true
		}
	}
	return plan.Reason{}, false
}

// touch is one existing file an action has to read, rename or overwrite, on one
// named side.
type touch struct {
	side plan.Side
	path string
}

// wantsToTouch lists the existing files an action needs to get at, so a lock on
// any of them is found before the action starts. A conflict touches a file on
// each side, and a lock on either would stop it partway through.
func wantsToTouch(act plan.Action) []touch {
	switch act.Kind {
	case plan.Copy, plan.Relocate:
		if act.SrcPath == "" {
			return nil
		}
		return []touch{{act.Src, act.SrcPath}}

	case plan.Move:
		// A rename is applied on the destination side, to the old name.
		if act.OldDstPath == "" {
			return nil
		}
		return []touch{{act.Dst, act.OldDstPath}}

	case plan.Delete:
		// A path gone from both sides only has its record cleared.
		if act.DstPath == "" || (act.LeftNow == nil && act.RightNow == nil) {
			return nil
		}
		return []touch{{act.Dst, act.DstPath}}

	case plan.Conflict:
		var out []touch
		if act.LeftNow != nil {
			out = append(out, touch{plan.Left, act.LeftNow.Path})
		}
		if act.RightNow != nil {
			out = append(out, touch{plan.Right, act.RightNow.Path})
		}
		return out
	}
	return nil
}

// couldHaveLocked lists the files a failed action might have been stopped by:
// wantsToTouch plus the destination, which is only probed once the attempt has
// failed. rclone renames a temporary file onto the destination, and Windows
// refuses that for a held file with a plain access denial, which a permission
// problem also produces, so the file has to be asked directly.
func couldHaveLocked(act plan.Action) []touch {
	out := wantsToTouch(act)
	if act.DstPath == "" {
		return out
	}
	switch act.Kind {
	case plan.Copy, plan.Move, plan.Relocate:
		return append(out, touch{act.Dst, act.DstPath})
	}
	return out
}

// whyFailed turns a failed operation into the reason the run writes down: a
// file held open by another program, a checksum the job insisted on and could
// not get, or an ordinary failure in the backend's own words.
//
// A lock shows either in the error number, which misses the rename of a
// temporary file, or by probing the suspects once the operation has failed.
// what names the operation for the sentence, and ordinary is the reason code
// to fall back on.
func whyFailed(ends Ends, suspects []touch, what, ordinary string, err error) plan.Reason {
	var unver *UnverifiedError
	if errors.As(err, &unver) {
		return plan.Because("unverified", "what", what, "side", unver.Side.String())
	}
	for _, s := range suspects {
		full, ok := localPath(ends.side(s.side), s.path)
		if ok && lockprobe.Busy(full) {
			return plan.Because("heldOpenDuring", "what", what, "side", s.side.String(), "error", err.Error())
		}
	}
	if lockprobe.WasBusy(err) {
		// The lock has since been released, as around a document being saved,
		// so no side is known.
		return plan.Because("heldOpenDuring", "what", what, "error", err.Error())
	}
	return plan.Because(ordinary, "what", what, "error", err.Error())
}

// localPath maps an rclone object back to a real filesystem path, for the local
// backend only. On Windows Root() returns the extended-length prefix with
// forward slashes, "//?/C:/...", and filepath.Join cleans it back into the
// backslash form Win32 accepts.
func localPath(f fs.Fs, remote string) (string, bool) {
	if f == nil || f.Name() != "local" {
		return "", false
	}
	return filepath.Join(f.Root(), filepath.FromSlash(remote)), true
}

// worthRepeating asks rclone whether an error is transient. ShouldRetry knows
// timeouts, resets and the HTTP codes that mean later; IsRetryError catches the
// marker a backend puts on an error itself. Neither says yes to a permission
// error or a full disk.
func worthRepeating(err error) bool {
	return fserrors.ShouldRetry(err) || fserrors.IsRetryError(err)
}

// retrying runs a transfer up to three times with a widening gap while the
// error is worth repeating, so a network that drops for two seconds does not
// fail the file. A cancelled run stops during the wait.
func retrying(ctx context.Context, what func() error) error {
	const attempts = 3
	var err error
	for attempt := 1; ; attempt++ {
		err = what()
		if err == nil || attempt == attempts || !worthRepeating(err) {
			return err
		}
		pause := time.Duration(attempt) * 2 * time.Second
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pause):
		}
	}
}

func one(ctx context.Context, ends Ends, rec recorder, act plan.Action, runID string, opt plan.Options, t *tally) error {
	switch act.Kind {
	case plan.Copy:
		src, dst := ends.side(act.Src), ends.side(act.Dst)
		// A failure to keep the old version stops the copy, since the promise
		// is that the old content is kept before the new content lands.
		if err := keepVersion(ctx, dst, act.DstPath, runID); err != nil {
			return err
		}
		if err := retrying(ctx, func() error {
			return operations.CopyFile(ctx, dst, src, act.DstPath, act.SrcPath)
		}); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Copied++ })
		// The source's size is what was just written.
		from := act.RightNow
		if act.Dst == plan.Right {
			from = act.LeftNow
		}
		t.sized("copy", act.DstPath, act.Dst.String(), sizeOf(from))
		left, right := act.Names()
		return rec.settle(ctx, act.Path, left, right)

	case plan.Relocate:
		// A copy, and then the source's own file goes. The removal is only
		// reached after the copy succeeded, which a Copy followed by a Delete
		// in the action list could not guarantee.
		src, dst := ends.side(act.Src), ends.side(act.Dst)
		if err := keepVersion(ctx, dst, act.DstPath, runID); err != nil {
			return err
		}
		if err := retrying(ctx, func() error {
			return operations.CopyFile(ctx, dst, src, act.DstPath, act.SrcPath)
		}); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Copied++ })
		sent := act.RightNow
		if act.Dst == plan.Right {
			sent = act.LeftNow
		}
		t.sized("copy", act.DstPath, act.Dst.String(), sizeOf(sent))

		// Into the source side's own bin, like every other removal.
		if sent != nil {
			if err := discard(ctx, src, sent.Object(), runID); err != nil {
				return err
			}
			t.count(func(r *Result) { r.Moved++ })
			t.sized("move", act.SrcPath, act.Src.String(), sent.Size)
		}
		left, right := act.Names()
		return rec.settle(ctx, act.Path, left, right)

	case plan.Move:
		dst := ends.side(act.Dst)
		if err := retrying(ctx, func() error {
			return operations.MoveFile(ctx, dst, dst, act.DstPath, act.OldDstPath)
		}); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Moved++ })
		moved := act.LeftNow
		if act.Dst == plan.Right {
			moved = act.RightNow
		}
		t.sized("move", act.DstPath, act.Dst.String(), sizeOf(moved))
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
		if err := discard(ctx, ends.side(act.Dst), live.Object(), runID); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Trashed++ })
		t.sized("trash", live.Path, act.Dst.String(), live.Size)
		return rec.db.Forget(ctx, act.Path)

	case plan.Conflict:
		t.count(func(r *Result) { r.Conflicts++ })
		// Record what was decided, since on a scheduled run nobody chose.
		t.note("conflict", spelled(act), "", act.Resolve.String())
		return resolveConflict(ctx, ends, rec, act, runID, opt)
	}
	return fmt.Errorf("unknown action kind %v", act.Kind)
}

// discard gets rid of an object: into the side's own trash, or outright when
// the job keeps none, in which case the reserved folder is never created.
//
// The trash lives inside the synced tree under a reserved prefix the scanner
// skips, because an S3 bucket or an SFTP export often has no outside. Deletions
// and a conflict's losing version both come through here, so they answer the
// question the same way.
func discard(ctx context.Context, f fs.Fs, obj fs.Object, runID string) error {
	if !trashKept(ctx) {
		return operations.DeleteFile(ctx, obj)
	}
	dst := path.Join(scan.TrashDir, runID, obj.Remote())
	return operations.MoveFile(ctx, f, f, dst, obj.Remote())
}

// resolveConflict keeps both versions and leaves the two sides identical. The
// newer file keeps the plain name and the older one is kept beside it under a
// name that says where it came from. That can pick the wrong file, but it
// destroys nothing and converges, where refusing to resolve would report the
// same conflict for ever.
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
	if last.losingName == "" {
		// A chosen resolution leaves one file. A row for a file that is not
		// there would read as a deletion on the next run.
		return nil
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
// between any two steps and every prefix has to leave a tree the next run can
// recover from.
//
// The recovery comes from the decision table: a crash after the first step
// leaves "deleted on one side, edited on the other", which restores the file.
// Copying the losing version across before setting it aside would leave the
// plain name contested and cost an extra round to converge.
func conflictSteps(ends Ends, act plan.Action, runID string) ([]conflictStep, error) {
	if act.LeftNow == nil || act.RightNow == nil {
		return nil, fmt.Errorf("conflict without both sides present")
	}

	if act.Resolve != plan.KeepBoth {
		return chosenSteps(ends, act, runID)
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

// chosenSteps resolves a conflict the way a person asked for rather than by
// modification time. The losing version goes to the trash, so a click on the
// wrong row can be undone. The order is safe for the same reason as in
// conflictSteps.
func chosenSteps(ends Ends, act plan.Action, runID string) ([]conflictStep, error) {
	winner, loser := plan.Left, plan.Right
	if act.Resolve == plan.KeepRight {
		winner, loser = plan.Right, plan.Left
	}
	winnerNow, loserNow := act.LeftNow, act.RightNow
	if winner == plan.Right {
		winnerNow, loserNow = act.RightNow, act.LeftNow
	}
	winnerFs, loserFs := ends.side(winner), ends.side(loser)

	step := func(what string, fn func(context.Context) error) conflictStep {
		// No losing name: nothing is left beside the file, so there is no
		// second record to write.
		return conflictStep{what: what, do: fn, plainName: winnerNow.Path}
	}

	return []conflictStep{
		step(fmt.Sprintf("get rid of the %s version", loser), func(ctx context.Context) error {
			return discard(ctx, loserFs, loserNow.Object(), runID)
		}),
		step(fmt.Sprintf("copy the %s version over", winner), func(ctx context.Context) error {
			return operations.CopyFile(ctx, loserFs, winnerFs, winnerNow.Path, winnerNow.Path)
		}),
	}, nil
}

// conflictName builds the name the losing version is kept under. The timestamp
// keeps repeated conflicts on one file from overwriting each other.
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
	verify Verify

	// observe gets a line into the run's list without handing the recorder
	// the counters. It may be nil.
	observe func(kind, path, side, note string)
}

func (r recorder) say(kind, path, side, note string) {
	if r.observe != nil {
		r.observe(kind, path, side, note)
	}
}

// settle re-reads a path on both sides and stores it as the new agreement.
//
// Assuming the destination matches the source would be cheaper, but a backend
// that rounds modification times or rewrites a name would then leave a row
// describing something that is not there. The equality check must stay: a row
// for a pair that does not agree would make every later run see no change, so
// the run fails loudly instead.
//
// With a checksum from both sides the check compares content; without one it
// falls back to size and modification time, which is weaker and is reported,
// and a job can refuse it; see Verify.
func (r recorder) settle(ctx context.Context, key, leftPath, rightPath string) error {
	left, lErr := reread(ctx, r.ends.Left, leftPath)
	right, rErr := reread(ctx, r.ends.Right, rightPath)

	// Only a file that is really not there drops the record. Dropping it
	// because a stat failed would make the next run treat a file it had just
	// copied as new.
	if errors.Is(lErr, fs.ErrorObjectNotFound) || errors.Is(rErr, fs.ErrorObjectNotFound) {
		return r.db.Forget(ctx, key)
	}
	if lErr != nil {
		return fmt.Errorf("re-read %q on the left: %w", leftPath, lErr)
	}
	if rErr != nil {
		return fmt.Errorf("re-read %q on the right: %w", rightPath, rErr)
	}

	leftSum, leftHashErr := hashOf(ctx, left)
	rightSum, rightHashErr := hashOf(ctx, right)
	leftFacts := plan.Facts{Size: left.Size(), Mod: left.ModTime(ctx), Hash: leftSum}
	rightFacts := plan.Facts{Size: right.Size(), Mod: right.ModTime(ctx), Hash: rightSum}
	if !plan.Same(leftFacts, rightFacts, r.window) {
		// The checksums belong in the message: when they decide, the sizes and
		// times match and would describe a disagreement that looks like
		// agreement.
		return &DisagreementError{
			Path:    key,
			Details: fmt.Sprintf("left %s, right %s", describeSide(leftPath, leftFacts), describeSide(rightPath, rightFacts)),
		}
	}

	// Same agreed either on checksums or on size and time alone.
	if leftSum == "" || rightSum == "" {
		side, why := unhashed(leftSum, leftHashErr, rightHashErr)
		if r.verify.RequireChecksum {
			return &UnverifiedError{Path: key, Side: side, Err: why}
		}
		// A backend without checksums is true of every file in the job and
		// would bury the list; any other checksum failure is worth a line.
		if !errors.Is(why, hash.ErrUnsupported) {
			r.say("unverified", key, side.String(), fmt.Sprintf(
				"no checksum from the %s side, so this pair was accepted on size and modification time alone: %v", side, why))
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

// hashOf asks an object for its MD5, and returns why it could not have one. It
// is always MD5 because the scanner compares MD5 against the state row, and any
// other algorithm stored here would look like a changed file on every run.
func hashOf(ctx context.Context, obj fs.Object) (string, error) {
	sum, err := obj.Hash(ctx, hash.MD5)
	if err != nil {
		return "", err
	}
	// An empty answer without an error means the same as unsupported.
	if sum == "" {
		return "", hash.ErrUnsupported
	}
	return sum, nil
}

// unhashed names the side that could not produce a checksum, and why. When
// neither side can, the left is named.
func unhashed(leftSum string, leftErr, rightErr error) (plan.Side, error) {
	if leftSum == "" {
		return plan.Left, leftErr
	}
	return plan.Right, rightErr
}

// describeSide is one side of a disagreement in one clause, checksum included.
func describeSide(path string, f plan.Facts) string {
	sum := f.Hash
	if sum == "" {
		sum = "no checksum"
	}
	return fmt.Sprintf("%q is %d bytes at %s, %s", path, f.Size, f.Mod.UTC().Format(time.RFC3339Nano), sum)
}

func contains(kinds []plan.Kind, k plan.Kind) bool {
	for _, want := range kinds {
		if want == k {
			return true
		}
	}
	return false
}

// reread looks a path up again after it has been written. It retries briefly
// because on Windows an indexer or virus scanner can hold a file that was just
// closed. A file that is absent is not retried.
func reread(ctx context.Context, f fs.Fs, path string) (fs.Object, error) {
	var err error
	for attempt := range 3 {
		var obj fs.Object
		obj, err = f.NewObject(ctx, path)
		if err == nil {
			return obj, nil
		}
		if errors.Is(err, fs.ErrorObjectNotFound) || errors.Is(err, fs.ErrorIsDir) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 20 * time.Millisecond):
		}
	}
	return nil, err
}
