// Package apply executes a plan and records the result.
//
// Two rules govern everything here. Nothing is destroyed outright unless
// somebody said so: a deletion is a move into the side's own trash, and the one
// way past that is a job explicitly configured without one, which is a decision
// made about those particular files rather than a default. And the state row
// for a path is written the moment that path is settled, not once at the end,
// so a run that dies halfway leaves a state that is incomplete but never wrong.
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

	"github.com/junkerderprovinz/arrowloop/internal/lockprobe"
	"github.com/junkerderprovinz/arrowloop/internal/pathid"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// Progress is told what a run is doing while it does it.
//
// A long run that shows nothing is indistinguishable from one that has hung,
// and the person watching has no way to tell which. The engine already knows
// the total before it starts, because the plan is built first, so there is no
// excuse for a spinner.
//
// Implementations are called from several workers at once and must be safe for
// that. A nil Progress means nobody is watching.
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
	// piece of work.
	//
	// The counts above answer "how much" and that turned out not to be the
	// question anybody has afterwards. A run reporting one error says nothing
	// about which file; a run reporting two conflicts says nothing about what it
	// decided, and for a scheduled run that decision was made on somebody's
	// behalf while they were not watching.
	Entries []Entry
}

// Entry is one finished piece of work, recorded rather than only counted.
type Entry struct {
	Kind string
	Side string
	Path string
	// Note carries what a number cannot: an error's own words, or which way a
	// conflict went. Empty for the ordinary case.
	Note string
	// Size is how big the file was, in bytes, where the action had one.
	//
	// Zero for a folder, for a skip and for an error: those have no size, and
	// zero reads as "not applicable" rather than as "an empty file", which is
	// the only ambiguity worth having here. A per-file log without sizes can
	// say what moved and not what it cost, and "why did this run take an hour"
	// is a question about bytes.
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
// PROVE it, on a job that asked for proof.
//
// It is not a disagreement and does not stop the run. The bytes are across, the
// file is there, and the only thing missing is the state row saying so, which
// costs the next run a comparison and costs nobody any data.
type UnverifiedError struct {
	Path string
	Side plan.Side
	// Err is what the backend said when asked for a checksum, which is the
	// difference between "this backend has no checksums" and "this file could
	// not be read". Only the second is alarming.
	Err error
}

func (e *UnverifiedError) Error() string {
	return fmt.Sprintf("not recording %q as agreed: the %s side could not produce a checksum: %v", e.Path, e.Side, e.Err)
}

func (e *UnverifiedError) Unwrap() error { return e.Err }

// Verify says how much proof a run demands before it writes down that two sides
// hold the same file.
//
// The default, the zero value, is what every existing caller gets and is what
// the engine has always done: compare checksums where both sides can produce
// them, and fall back to size and modification time where they cannot. That
// fallback is not paranoia satisfied, it is a real weakening, and until now
// nothing in the run said which of the two had happened.
type Verify struct {
	// RequireChecksum refuses to record an agreement that rests on size and
	// modification time alone.
	//
	// Off by default, and it has to be, because whole backends cannot hash at
	// all: plain SFTP without a remote shell answers nothing, and a job across
	// one would postpone every single file on every single run. Turning this on
	// is a statement about a particular pair of ends, made by somebody who
	// knows those ends can hash and wants to hear about it the day one of them
	// stops.
	//
	// A refusal costs the copy nothing. The file has already been written, and
	// only the row saying the two sides agree is withheld, so the next run
	// looks again. What it does NOT do is converge: a pair that can never be
	// checksummed will be reconsidered on every run forever. That is the point
	// of asking for it.
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

// step reports one finished piece of work. The count is taken under the same
// lock as everything else, so the numbers a watcher sees always add up even
// when several workers finish at the same instant.
func (t *tally) step(kind, path, side string) {
	t.note(kind, path, side, "")
}

// sized is step for a piece of work that moved a known number of bytes.
//
// Separate from step rather than a fifth parameter on it, because most of the
// callers have no size to give: a folder made, a path skipped and an error
// raised are all sizeless, and passing 0 at each of them would read as "an
// empty file" at the call site rather than as "not applicable".
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

// sizeOf is the size of whichever side an action is acting on, or zero when
// there is nothing there to measure.
func sizeOf(e *scan.Entry) int64 {
	if e == nil {
		return 0
	}
	return e.Size
}

// note is step with something to say about this particular piece of work: the
// words of an error, or which way a conflict went.
//
// Recorded under the same lock as the count, so the list and the numbers can
// never describe two different runs. Several workers finish at once, and a
// slice appended to from more than one of them without the lock is a data race
// that shows up as a corrupted history rather than as a crash.
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

// observe records something true about one file that is not a piece of work:
// how an agreement was verified, why a check was weaker than usual.
//
// Deliberately not through note(), for the same reason skip() is not: countWork
// counted the transfers, and a remark ABOUT a transfer is not a second one.
// Sending these through note() would walk the progress bar past its own total,
// and a bar that reads 106 of 100 is worse than no bar at all.
func (t *tally) observe(kind, path, side, note string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.record(Entry{Kind: kind, Side: side, Path: path, Note: note})
}

// record appends one line to the run's list. The caller holds the mutex, so
// that a count and its line are always taken together.
func (t *tally) record(e Entry) { t.res.Entries = append(t.res.Entries, e) }

// countWork is what the plan is going to touch, worked out before anything
// moves. A progress bar whose total grows while it runs is not a progress bar.
func countWork(p *plan.Plan) int {
	n := len(p.Actions) + len(p.Agreed)
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

func (t *tally) skip(path string, reason plan.Reason) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.res.Skipped = append(t.res.Skipped, plan.Skip{Path: path, Reason: reason})
	// A skip is a thing that happened to a named file, and until now the only
	// place it went was a count. "One file was skipped" is not something anybody
	// can act on; the name and the reason are.
	//
	// Deliberately NOT through note(): a skip is not a finished piece of work
	// and must not move the progress bar, which is the one thing note() does
	// besides recording.
	t.record(Entry{Kind: "skip", Path: path, Note: reason.String()})
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
	return RunWatched(ctx, ends, db, p, opt, nil)
}

// RunWatched is Run with somebody looking over its shoulder.
func RunWatched(ctx context.Context, ends Ends, db *state.DB, p *plan.Plan, opt plan.Options, watcher Progress) (Result, error) {
	return RunVerified(ctx, ends, db, p, opt, watcher, Verify{})
}

// RunVerified is RunWatched with the strength of the after-the-fact check
// spelled out rather than left at its default.
//
// A separate entry point rather than another field on plan.Options, because
// plan.Options is the bag the COMPARISON reads: how names fold, how wide the
// time window is, what the brakes allow. How hard the apply stage insists on
// proof after a write is not a question the planner has any use for, and adding
// it there would put a setting in front of every caller that builds a plan and
// never applies one.
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
			t.skip(d.Path, whyFailed(ends, nil, d.Kind.String(), "stepFailed", err))
			continue
		}
		if d.Kind == plan.MakeDir {
			t.count(func(r *Result) { r.DirsMade++ })
			t.step("mkdir", d.DstPath, d.Dst.String())
		}
	}

	// Renames stay sequential. Two of them in flight can chase each other
	// through the same name, and folding a rename into a single move is cheap
	// anyway, so there is nothing to gain by racing them.
	for _, act := range p.Actions {
		if act.Kind != plan.Move {
			continue
		}
		if why, busy := heldOpen(ends, act); busy {
			t.skip(act.Path, why)
			continue
		}
		if err := one(ctx, ends, rec, act, runID, opt, t); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return t.res, err
			}
			t.skip(act.Path, whyFailed(ends, couldHaveLocked(act), "move", "stepFailed", err))
		}
	}

	for _, group := range [][]plan.Kind{{plan.Copy, plan.Conflict}, {plan.Delete}} {
		acts := ofKind(p.Actions, group...)
		if err := t.forEach(ctx, ends, acts, opt.Transfers, func(ctx context.Context, act plan.Action) error {
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
		// WITH its size, even though nothing was transferred. The row describes
		// a file and the file has a size, and on a settled pair of trees this
		// is nearly every row there is: without it the activity log's size
		// column is blank on 696 lines out of 697, which is what "die
		// dateigröße ist nicht sichtbar" looked like from the outside. Either
		// side will do, since agreeing is what put them in this list.
		agreed := act.LeftNow
		if agreed == nil {
			agreed = act.RightNow
		}
		t.sized("record", act.Path, "", sizeOf(agreed))
		if err := rec.settle(ctx, act.Path, left, right); err != nil {
			var dis *DisagreementError
			if errors.As(err, &dis) {
				return t.res, err
			}
			t.skip(act.Path, whyFailed(ends, couldHaveLocked(act), "record", "recordFailed", err))
		}
	}

	// Removals last, deepest first, so a parent is only tried once its children
	// are gone.
	for _, d := range p.Dirs {
		if d.Kind != plan.RemoveDir {
			continue
		}
		if err := applyDir(ctx, ends, db, d); err != nil {
			t.skip(d.Path, whyFailed(ends, nil, "removing the folder", "removeDirFailed", err))
			continue
		}
		t.count(func(r *Result) { r.DirsRemoved++ })
		t.step("rmdir", d.DstPath, d.Dst.String())
	}

	return t.res, t.fatalErr()
}

// forEach runs the actions concurrently, up to workers at a time.
//
// A failure on one file becomes a skip and the others carry on. A disagreement
// is different: it says the engine's picture of the tree is wrong, so the
// context is cancelled and the whole run stops rather than taking further
// decisions on a false basis.
//
// It is handed the two ends only so that a failure can be classified: naming
// what stopped a file means asking the file, and the file lives on one of them.
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
					t.skip(act.Path, whyFailed(ends, couldHaveLocked(act), act.Kind.String(), "stepFailed", err))
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

// heldOpen asks whether any file this action has to get at is locked by another
// program, before the action is attempted.
//
// It used to ask about copies only, and only about their source. That covered
// the single case somebody thinks of first, a document left open in a word
// processor, and left three others reporting a raw Win32 sentence under the
// generic "step failed" reason: a rename of an open file, a conflict whose two
// versions cannot be shuffled about, and a deletion that cannot move its victim
// into the trash. All four are the same situation with the same remedy, and the
// person reading the run has no way to reach that remedy from "MoveFile
// notes.txt: The process cannot access the file".
//
// The destination of a copy is still not probed here. Probing it means opening
// a file the run is about to overwrite, which is an intrusion of its own for an
// answer the attempt itself will give. It is asked about afterwards instead,
// once something has actually gone wrong: see couldHaveLocked.
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

// wantsToTouch lists the files an action needs to get at, so that a lock on any
// of them is found before the action starts rather than halfway through it.
//
// Only files that must ALREADY be there are listed. The destination name of a
// copy or a rename is usually nothing at all, and probing a path that does not
// exist answers "not busy" truthfully and uselessly.
//
// The conflict case is why this returns a list rather than one path. Resolving a
// conflict moves one version aside and copies in both directions, so it touches
// a real file on each side, and a lock on either of them will stop it partway
// through a manoeuvre that is only safe as a whole.
func wantsToTouch(act plan.Action) []touch {
	switch act.Kind {
	case plan.Copy:
		if act.SrcPath == "" {
			return nil
		}
		return []touch{{act.Src, act.SrcPath}}

	case plan.Move:
		// The file being renamed lives on the destination side under its old
		// name: a rename is applied over there, not carried across.
		if act.OldDstPath == "" {
			return nil
		}
		return []touch{{act.Dst, act.OldDstPath}}

	case plan.Delete:
		// A path already gone from both sides has nothing behind it to lock;
		// only its record is being cleared.
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

// couldHaveLocked lists the files a failed action might have been stopped by.
//
// It is wantsToTouch plus the destination, and the destination is why it exists
// separately. Probing a destination BEFORE a copy means opening a file the run
// is about to overwrite, for an answer the attempt itself will give. Probing it
// AFTER the attempt failed costs one open on a path that has already gone
// wrong, and it is the only way to recognise the commonest case of all.
//
// rclone does not write over the destination. It writes a temporary name beside
// it and renames that into place, and Windows refuses a rename onto a file
// somebody is holding with a plain access denial rather than with a sharing
// violation. Access denied is also exactly what a genuine permission problem
// looks like, and the two want opposite things from the reader, so the error
// number cannot settle this on its own and the file has to be asked directly.
func couldHaveLocked(act plan.Action) []touch {
	out := wantsToTouch(act)
	if act.DstPath == "" {
		return out
	}
	switch act.Kind {
	case plan.Copy, plan.Move:
		return append(out, touch{act.Dst, act.DstPath})
	}
	return out
}

// whyFailed turns a failed operation into the reason the run writes down.
//
// Three failures that read alike to the code are three different messages to
// the person holding the machine. "Another program has this file open" is
// something they can fix in ten seconds and is not a fault. "This job insists
// on a checksum and could not get one" is a decision the job made about itself.
// Everything else is an ordinary failure carrying the backend's own words.
// Before this, all three arrived as one reason code with a raw error glued on,
// so the only way to tell a busy document from a full disk was to read Win32
// error prose, in whatever language that machine speaks, and know what it meant.
//
// The lock is established two ways because neither is enough alone. The error
// number is proof when it is one of the sharing violations, and no help at all
// when the operation that died was the rename of a temporary file. Asking the
// files is the other way, and it is only asked once the operation has already
// failed: a file that probes busy at that moment is the explanation, and a
// probe on a run where nothing went wrong would be a guess looking for
// something to blame.
//
// what names the operation for the sentence. ordinary is the code to fall back
// on, because "the folder could not be removed" and "the copy failed" send the
// reader to different places and collapsing them would be a loss.
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
		// The operating system said so and the lock has since been released,
		// which happens constantly: a document is saved, and the lock is taken
		// and given back around the save. No side is named because none is
		// known, and naming one on a guess would send somebody to the wrong
		// machine.
		return plan.Because("heldOpenDuring", "what", what, "error", err.Error())
	}
	return plan.Because(ordinary, "what", what, "error", err.Error())
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
		// Whatever this copy is about to replace is kept first, when the run was
		// told to keep versions. A failure here stops the copy on purpose: the
		// whole promise is that the old content is somewhere before the new
		// content lands on it, and a keep that quietly failed would break that
		// promise on exactly the file somebody later goes looking for.
		//
		// It makes no backend calls at all when versioning is off, which is
		// every run today.
		if err := keepVersion(ctx, dst, act.DstPath, runID); err != nil {
			return err
		}
		if err := operations.CopyFile(ctx, dst, src, act.DstPath, act.SrcPath); err != nil {
			return err
		}
		t.count(func(r *Result) { r.Copied++ })
		// The SOURCE's size, which is what was just written. The destination's
		// is the old file's where there was one, and zero where there was not.
		from := act.RightNow
		if act.Dst == plan.Right {
			from = act.LeftNow
		}
		t.sized("copy", act.DstPath, act.Dst.String(), sizeOf(from))
		left, right := act.Names()
		return rec.settle(ctx, act.Path, left, right)

	case plan.Move:
		dst := ends.side(act.Dst)
		if err := operations.MoveFile(ctx, dst, dst, act.DstPath, act.OldDstPath); err != nil {
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
		t.sized("trash", act.Path, act.Dst.String(), live.Size)
		return rec.db.Forget(ctx, act.Path)

	case plan.Conflict:
		t.count(func(r *Result) { r.Conflicts++ })
		// What was DECIDED, not only that there was a conflict. On a scheduled
		// run nobody chose, so the default was taken on somebody's behalf and
		// this line is the only place that ever says so.
		t.note("conflict", act.Path, "", act.Resolve.String())
		return resolveConflict(ctx, ends, rec, act, runID, opt)
	}
	return fmt.Errorf("unknown action kind %v", act.Kind)
}

// discard gets rid of an object: into the side's own trash, or outright when
// this job has been told not to keep one.
//
// The trash lives inside the synced tree but under a reserved prefix that the
// scanner skips, so it never travels to the other side. Putting it outside the
// tree instead would be cleaner in principle and unusable in practice: on an
// S3 bucket or an SFTP export there is often no "outside".
//
// That reserved folder is also the whole of what somebody sees of this
// mechanism, and it is what gets asked about: jdp, looking at a synced download
// share, "braucht es den .arrowloop ordner im Zielordner? Kann man den nicht
// weglassen?" It can, and this is where: with the trash off nothing is ever
// moved under the prefix, so the folder is never created. The decision lives on
// the job because it is a decision about what THOSE files are worth.
//
// The choice is made here rather than at the two call sites, so that both a
// deletion and a conflict's losing version answer it the same way. Two copies
// of this `if` would eventually disagree, and the one that kept a trash nobody
// asked for would be the quiet one.
func discard(ctx context.Context, f fs.Fs, obj fs.Object, runID string) error {
	if !trashKept(ctx) {
		return operations.DeleteFile(ctx, obj)
	}
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
	if last.losingName == "" {
		// A chosen resolution leaves one file, so there is one row to write.
		// Forgetting the second is not an omission here: writing a row for a
		// file that is not there would have the next run read it as a deletion
		// and go looking for something to remove.
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

// chosenSteps resolves a conflict the way a person looking at both versions
// asked for, rather than by modification time.
//
// The losing version goes to the trash rather than being overwritten. Somebody
// choosing between two files is saying which one they want next to them, not
// that the other should stop existing: a click made in a hurry on the wrong row
// has to be recoverable, and the trash is already where every other deletion in
// this program goes.
//
// The two steps are in this order for the same reason the three above are: a
// crash between them leaves "deleted on one side, edited on the other", which
// the decision table restores rather than propagates.
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
	verify Verify

	// observe is how the recorder gets a line into the run's list without
	// being handed the whole tally. A recorder that could reach the counters
	// would eventually increment one.
	//
	// Nil when nobody is collecting, which is the case in the tests that drive
	// a recorder directly, so every call has to survive it.
	observe func(kind, path, side, note string)
}

func (r recorder) say(kind, path, side, note string) {
	if r.observe != nil {
		r.observe(kind, path, side, note)
	}
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
//
// How strong that check is depends on what the two backends can answer. With a
// checksum from both sides it is a comparison of the content; without one it
// falls back to a length and a clock reading, which two different files can
// share. The fallback is necessary and it is genuinely weaker, and until it was
// written down here the run said the same word, "agreed", for both. It now says
// which, and a job can refuse the weak one outright: see Verify.
func (r recorder) settle(ctx context.Context, key, leftPath, rightPath string) error {
	left, lErr := reread(ctx, r.ends.Left, leftPath)
	right, rErr := reread(ctx, r.ends.Right, rightPath)

	// A file that is genuinely not there means the two sides agree on nothing,
	// so the record goes. Any OTHER failure to look is a different thing
	// entirely and must not be treated the same way: dropping the record
	// because a stat happened to fail would make the next run treat a file it
	// had just copied as brand new, and nothing anywhere would say why. Found
	// on a Windows runner, where two of two hundred files came out of a
	// parallel run with no record at all.
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
		// The checksums belong in the message. The one case where a checksum
		// decides anything is two files of the same length written in the same
		// second, and in exactly that case the sizes and the times read as a
		// matched pair, so a message built from those two alone describes a
		// disagreement that looks like agreement and sends the reader hunting
		// for a bug in the comparison instead of at the file.
		return &DisagreementError{
			Path:    key,
			Details: fmt.Sprintf("left %s, right %s", describeSide(leftPath, leftFacts), describeSide(rightPath, rightFacts)),
		}
	}

	// Same() reached that verdict one of two ways, and which one is not
	// something the caller can work out afterwards.
	if leftSum == "" || rightSum == "" {
		side, why := unhashed(leftSum, leftHashErr, rightHashErr)
		if r.verify.RequireChecksum {
			return &UnverifiedError{Path: key, Side: side, Err: why}
		}
		// Reported for the surprising case only. A backend that has no
		// checksums at all is a fact about the job, true of every file in it,
		// and one line per file would bury the run's own list under thousands
		// of copies of a sentence nobody needed twice. A checksum that failed
		// for any OTHER reason is a fact about THIS file and is worth a line.
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

// hashOf asks an object for its MD5, and returns why it could not have one.
//
// MD5 specifically, and not whichever algorithm the two backends happen to
// share. The scanner records MD5 into the state row and compares MD5 against it
// on the next run, so a settle that stored a SHA-1 here would look like a
// changed file to every run that followed, forever. One algorithm or none.
//
// The error used to be dropped on the floor. That is what made the two very
// different answers, "this backend has no checksums" and "this file could not
// be read", arrive as the same empty string, and an empty string is what makes
// the comparison fall back to size and time without a word.
func hashOf(ctx context.Context, obj fs.Object) (string, error) {
	sum, err := obj.Hash(ctx, hash.MD5)
	if err != nil {
		return "", err
	}
	// A backend can answer successfully with nothing at all, for an object it
	// has never been told the checksum of. That is the unsupported case wearing
	// different clothes, and the caller has one meaning for it.
	if sum == "" {
		return "", hash.ErrUnsupported
	}
	return sum, nil
}

// unhashed names the side that could not produce a checksum, and why.
//
// The left side is asked about first, so a pair where neither side can hash is
// reported against the left. Naming both would be more accurate and less
// useful: the reader has to go and look at one of them first anyway, and a
// sentence that names two sides at once reads as though the problem were the
// pairing rather than the backends.
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

// reread looks a path up again after it has been written.
//
// The retry is for Windows. A file that has just been closed can still be
// briefly unavailable there, because an indexer or a virus scanner is holding
// it, and a caller that gives up on the first attempt turns that into a run
// that reports a failure for a file which is in fact perfectly fine. Three
// attempts over a few milliseconds costs nothing on the path where everything
// works, which is nearly always.
//
// A file that is genuinely absent is not retried: that answer will not change,
// and the caller has a correct meaning for it.
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
