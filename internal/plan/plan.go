// Package plan turns "what both sides look like now" plus "what they agreed on
// last time" into an ordered list of actions, without touching anything.
//
// Building the plan and applying it are deliberately separate. The plan is what
// the user gets shown before a single byte moves, and it is what the safety
// brakes are measured against. A design that decides and acts in the same pass
// cannot offer either.
package plan

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// Side names one end of a sync job.
type Side int

// The two ends. Left is conventionally the local side, but nothing in the
// engine depends on that.
const (
	Left Side = iota
	Right
)

// A reason travels twice: as the English sentence the command line and the log
// print, and as a code with its values, so that an interface reading in another
// language can say the same thing in that language.
//
// Translating on this side would be the worse trade. The engine would need to
// know the reader's language on every run, and the log would then be written in
// whichever language somebody last asked a question in.
//
// The sentence is built from the same template the interface translates, so the
// two cannot drift: there is one place where a reason is worded and one place
// where its values are named.
type Reason struct {
	Code string            `json:"code"`
	Vars map[string]string `json:"vars,omitempty"`
	Text string            `json:"text"`
}

// reasonText is the English wording of every reason the engine gives. An
// interface carries the same set keyed by the same codes.
var reasonText = map[string]string{
	"newOnSide":        "new on the {side}",
	"changedOnSide":    "changed on the {side}",
	"changedBothSame":  "changed on both sides to the same content",
	"changedBoth":      "changed on both sides",
	"deletedOnSide":    "deleted on the {side}",
	"restoredOnSide":   "edited on the {side} after being deleted on the {other}, restoring it",
	"renamedOnSide":    "renamed on the {side} side",
	"collision":        "the {side} side holds {names}, which the other side may not be able to tell apart; rename one of them",
	"settling":         "changed on the {side} side less than {period} ago, waiting for it to settle",
	"goneBoth":         "gone on both sides, dropping the record",
	"appearedSame":     "appeared on both sides with identical content",
	"appearedDiffer":   "appeared on both sides with different content",
	"dirBoth":          "on both sides",
	"dirNewOnSide":     "new folder on the {side}",
	"dirRemovedOnSide": "folder removed on the {side}",
	"dirGoneBoth":      "folder gone on both sides, dropping the record",

	// Reasons a run gives while it is running rather than while it is deciding.
	// Each carries the underlying error as a value, because a backend's own
	// words about what went wrong are worth more than any sentence written here.
	"stepFailed":      "{what} failed, leaving it for the next run: {error}",
	"removeDirFailed": "could not remove the folder, leaving it: {error}",
	"heldOpen":        "held open by another program on the {side} side, waiting for it to be closed",
	"heldOpenDuring":  "held open by another program while {what} was running, leaving it for the next run: {error}",
	"unverified":      "{what} finished, but the {side} side could not produce a checksum and this job insists on one; leaving it for the next run",
	"unsupported":     "{kind} on the {side} side, which this engine does not carry",
	"recordFailed":    "the record could not be written, leaving it for the next run: {error}",
	"oneWay":          "this job only writes away from the {side}, so the {side} version is the one that stands",
}

// String is the English sentence, so that anything printing a reason with %s or
// %v gets the sentence rather than the struct.
//
// Without it the command line printed "{newOnSide map[side:left] new on the
// left}" the moment a reason stopped being a plain string, in eight places at
// once, and every one of them looked correct in the diff that caused it.
func (r Reason) String() string { return r.Text }

// Because builds a reason from a code and its values, for the stages that
// discover one while running rather than while deciding.
func Because(code string, pairs ...string) Reason { return because(code, pairs...) }

// because builds a reason. The variadic values are key and value in turn, which
// keeps a call site to one line and reads in the order the sentence does.
//
// A code nobody has worded here answers with the code itself rather than with
// an empty string. That fallback was described one function down and never
// actually written, and the map was short of three codes the engine really
// produces: goneBoth, appearedSame and appearedDiffer. The result was a run that
// printed a path, a colon and then nothing at all, on the two cases anybody
// looking at a fresh pair of folders meets first. A missing sentence must be
// loud, because a blank one is indistinguishable from a reason that genuinely
// had nothing to add.
func because(code string, pairs ...string) Reason {
	vars := make(map[string]string, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		vars[pairs[i]] = pairs[i+1]
	}
	template, worded := reasonText[code]
	if !worded || template == "" {
		template = code
	}
	return Reason{Code: code, Vars: vars, Text: fill(template, vars)}
}

// fill substitutes {name} for the value of name.
func fill(template string, vars map[string]string) string {
	if template == "" {
		return ""
	}
	out := template
	for name, value := range vars {
		out = strings.ReplaceAll(out, "{"+name+"}", value)
	}
	return out
}

func (s Side) String() string {
	if s == Left {
		return "left"
	}
	return "right"
}

// Other returns the opposite side.
func (s Side) Other() Side {
	if s == Left {
		return Right
	}
	return Left
}

// Kind is what an action does.
type Kind int

// The five things that can happen to a file.
const (
	Copy     Kind = iota // bring one side's version over to the other
	Delete               // remove on one side because the other side removed it
	Move                 // apply a rename the other side made
	Conflict             // both sides changed it differently, keep both

	// Relocate copies to the other side and then removes the file from this
	// one, which is what a job in Move mode does with everything it sends.
	//
	// ONE action and not a copy followed by a delete, and that is the whole
	// reason it is a kind of its own. As two actions the delete sits in the
	// queue behind the copy, and a copy that fails leaves it there; as one,
	// the removal is unreachable unless the copy returned without error. It
	// also shows up in a preview as one line that says "moved", which is the
	// truth, rather than as two lines somebody has to pair up by eye.
	Relocate
)

func (k Kind) String() string {
	switch k {
	case Copy:
		return "copy"
	case Delete:
		return "delete"
	case Move:
		return "move"
	case Relocate:
		return "relocate"
	default:
		return "conflict"
	}
}

// Action is one change to make.
//
// Path is the matching key and is never handed to a backend. SrcPath, DstPath
// and OldDstPath are real names as each side spells them, which is not the same
// thing: a file stored decomposed on macOS and composed on Windows shares one
// key and has two spellings, and handing the wrong one to a backend produces a
// second file rather than an error.
type Action struct {
	Kind   Kind
	Path   string
	Src    Side
	Dst    Side
	Reason Reason

	SrcPath    string // Copy and Conflict: what the source side calls it
	DstPath    string // what the destination side should call it afterwards
	OldDstPath string // Move: where the destination side currently keeps it

	LeftNow  *scan.Entry
	RightNow *scan.Entry
	Prev     *state.Entry

	// Resolve applies to a conflict and to nothing else. Its zero value is
	// KeepBoth, which is what an unattended run always does: a scheduled job
	// has nobody to ask, and picking a winner unasked would delete somebody's
	// work while they were not looking.
	Resolve Resolution
}

// Resolution is what to do with the two versions of a file that disagree.
type Resolution int

const (
	// KeepBoth is the default and the only outcome a run reaches on its own.
	// The newer version keeps the plain name on both sides and the older is
	// preserved beside it. Nothing is lost and the job converges.
	KeepBoth Resolution = iota
	// KeepLeft and KeepRight are only ever set by a person looking at the two
	// versions. The losing version still goes to the trash rather than being
	// overwritten, because "I chose this one" and "I meant to destroy the
	// other one for good" are different statements.
	KeepLeft
	KeepRight
)

func (r Resolution) String() string {
	switch r {
	case KeepLeft:
		return "keep left"
	case KeepRight:
		return "keep right"
	default:
		return "keep both"
	}
}

// ParseResolution reads what a person picked. Anything unrecognised is the safe
// default rather than an error: a newer interface asking an older engine for a
// resolution it has never heard of must keep both versions, not fail the run
// and not guess.
func ParseResolution(text string) Resolution {
	switch text {
	case "left", "keep left":
		return KeepLeft
	case "right", "keep right":
		return KeepRight
	default:
		return KeepBoth
	}
}

// Names returns the path each side ends up holding once this action has run.
func (a Action) Names() (left, right string) {
	if a.Src == Left {
		return a.SrcPath, a.DstPath
	}
	return a.DstPath, a.SrcPath
}

// Skip is a path the run deliberately left alone, with the reason. Skips are
// not failures and not successes; they are work postponed, and the state row
// is left untouched so the next run reconsiders from scratch.
type Skip struct {
	Path   string
	Reason Reason
}

// Plan is the full set of changes for one run.
type Plan struct {
	Actions   []Action
	Unchanged int
	// Agreed lists paths that need no work but whose state row should be
	// written, because both sides produced the same file independently.
	Agreed  []Action
	Skipped []Skip
	// Dirs is empty unless the job syncs empty directories, which needs both
	// sides to be able to hold one.
	Dirs []DirAction
}

// Options is the per-job settings bag shared by the comparison and the apply
// stage: how files are judged equal, what the safety brakes allow, and how many
// transfers may be in flight at once.
type Options struct {
	// Direction is which way this job may write. The zero value is both ways,
	// which is the safe default: a direction nobody set must never silently
	// make one side authoritative over the other.
	Direction Direction

	// Mode is what a one-way job does beyond copying: nothing, mirror, or move.
	// The zero value is ModeSync, which is the mode that deletes nothing on its
	// own - the right default for a value a caller forgot to set.
	Mode Mode

	// Transfers is how many files may be copied at the same time. One is
	// correct but slow over a network, where most of the wall-clock time of a
	// small file is round trips rather than bytes.
	Transfers int

	// ModWindow is how far two modification times may differ and still count
	// as the same instant. Filesystems disagree wildly here: exFAT stores two
	// second resolution, S3 keeps whatever was put in the metadata. Two
	// seconds is the traditional rsync value. It only ever applies when at
	// least one side cannot produce a hash, because a hash comparison is
	// exact and needs no window.
	ModWindow time.Duration

	// QuietPeriod is how long a file has to sit unchanged before the engine
	// will touch it.
	//
	// This is not about latency, it is about half-written files. A run started
	// while somebody is saving a large document copies whatever is on disk at
	// that instant, and the copy is garbage. A schedule does not help: a run
	// every two minutes lands mid-write just as readily as a filesystem watch
	// does. Waiting for the file to stop changing is the only portable defence,
	// and it is worth more than any amount of cleverness afterwards.
	QuietPeriod time.Duration

	// Now is the reference point for QuietPeriod. Zero means time.Now, which
	// is what everything but the tests wants.
	Now time.Time

	// FoldCase records whether this job matches names case-insensitively. It is
	// derived from the two backends rather than configured: if either side
	// cannot tell "Bild.jpg" from "bild.jpg", the matching must fold for both.
	FoldCase bool

	// BrakePercent trips the mass-delete brake when a single run would delete
	// more than this share of the known files. Zero disables the brake.
	BrakePercent int

	// BrakeFloor is a number of deletions below which the brake never trips,
	// so that a tiny job is not blocked by its own arithmetic. Deleting three
	// of four files is 75 percent and almost certainly intentional.
	BrakeFloor int
}

// DefaultOptions is what the command line uses when nothing is given.
func DefaultOptions() Options {
	return Options{
		Transfers:    4,
		ModWindow:    2 * time.Second,
		QuietPeriod:  5 * time.Second,
		BrakePercent: 50,
		BrakeFloor:   10,
	}
}

func (o Options) now() time.Time {
	if o.Now.IsZero() {
		return time.Now()
	}
	return o.Now
}

// BrakeError is returned when a run would delete an implausible share of the
// tree. It carries enough detail for the message to be actionable, because a
// brake that only says "refused" trains the user to disable it.
type BrakeError struct {
	Deletes int
	Known   int
	Percent int
	Sample  []string
}

func (e *BrakeError) Error() string {
	return fmt.Sprintf("mass-delete brake: this run would delete %d of %d known files (%d%%, limit %d%%); first paths: %v",
		e.Deletes, e.Known, e.Deletes*100/max(e.Known, 1), e.Percent, e.Sample)
}

// EmptySideError is returned when a side lists nothing while the state says it
// used to hold files.
//
// This is the single most valuable check in the whole engine. The classic total
// loss is not a bug: a disk fails to mount, the side lists zero files, the
// engine reads that correctly as "everything was deleted" and correctly deletes
// it on the other side. Nothing malfunctioned. The only defence is to refuse to
// believe an empty side.
type EmptySideError struct {
	Side  Side
	Known int
}

func (e *EmptySideError) Error() string {
	return fmt.Sprintf("the %s side lists no files at all, but %d were known there last time; refusing to treat this as a deletion (is it mounted?)",
		e.Side, e.Known)
}

// status is how one side changed since the last agreement.
type status int

const (
	absent    status = iota // not there now, and not known before
	created                 // appeared since the last run
	unchanged               // there and identical to the last agreement
	modified                // there but different from the last agreement
	deleted                 // known before, gone now
)

// Facts is the minimum needed to compare two versions of a file. It is
// exported because the apply stage has to make exactly the same judgement when
// it decides whether two sides have really ended up equal, and two comparison
// functions that are meant to agree eventually will not.
type Facts struct {
	Size int64
	Mod  time.Time
	Hash string
}

// Same reports whether two versions of a file are the same content.
//
// The hash wins whenever both sides can produce one, and then the modification
// time is irrelevant. That matters more than it looks: with a two second
// window, a file edited twice within two seconds and left at the same length
// would otherwise be declared unchanged and silently not synced.
func Same(a, b Facts, window time.Duration) bool {
	if a.Hash != "" && b.Hash != "" {
		return a.Size == b.Size && a.Hash == b.Hash
	}
	if a.Size != b.Size {
		return false
	}
	diff := a.Mod.Sub(b.Mod)
	if diff < 0 {
		diff = -diff
	}
	return diff <= window
}

// Build compares both sides against the last agreed state.
func Build(ctx context.Context, left, right *scan.Listing, prev map[string]state.Entry, opt Options) (*Plan, error) {
	if len(prev) > 0 {
		if len(left.Files) == 0 {
			return nil, &EmptySideError{Side: Left, Known: len(prev)}
		}
		if len(right.Files) == 0 {
			return nil, &EmptySideError{Side: Right, Known: len(prev)}
		}
	}

	out := &Plan{}
	blocked := map[string]bool{}
	for side, listing := range map[Side]*scan.Listing{Left: left, Right: right} {
		for _, c := range listing.Collisions {
			blocked[c.Key] = true
			out.Skipped = append(out.Skipped, Skip{
				Path:   c.Key,
				Reason: because("collision", "side", side.String(), "names", fmt.Sprint(c.Paths)),
			})
		}
	}

	paths := make(map[string]struct{}, len(left.Files)+len(right.Files)+len(prev))
	for p := range left.Files {
		paths[p] = struct{}{}
	}
	for p := range right.Files {
		paths[p] = struct{}{}
	}
	for p := range prev {
		paths[p] = struct{}{}
	}

	ordered := make([]string, 0, len(paths))
	for p := range paths {
		if blocked[p] {
			continue
		}
		ordered = append(ordered, p)
	}
	sort.Strings(ordered)

	for _, p := range ordered {
		l, hasL := left.Files[p]
		r, hasR := right.Files[p]
		s, hasPrev := prev[p]

		lState := classify(ctx, l, hasL, hasPrev, Facts{s.LeftSize, s.LeftMod, s.LeftHash}, opt)
		rState := classify(ctx, r, hasR, hasPrev, Facts{s.RightSize, s.RightMod, s.RightHash}, opt)

		var prevPtr *state.Entry
		if hasPrev {
			copyOf := s
			prevPtr = &copyOf
		}
		base := Action{Path: p, LeftNow: l, RightNow: r, Prev: prevPtr}

		if lState == unchanged && rState == unchanged {
			out.Unchanged++
			continue
		}
		if why, tooSoon := settling(l, r, opt); tooSoon {
			out.Skipped = append(out.Skipped, Skip{Path: p, Reason: why})
			continue
		}

		switch {
		// Both sides forgot about it. Drop the row.
		case lState == deleted && rState == deleted:
			act := base
			act.Kind = Delete
			act.Dst = Left // no side is touched; apply only clears the state row
			act.Reason = because("goneBoth")
			act.LeftNow, act.RightNow = nil, nil
			out.Actions = append(out.Actions, act)

		// One side has it and nothing was ever agreed: a plain new file.
		case lState == created && rState == absent:
			out.Actions = append(out.Actions, copyAction(base, Left, because("newOnSide", "side", "left")))
		case rState == created && lState == absent:
			out.Actions = append(out.Actions, copyAction(base, Right, because("newOnSide", "side", "right")))

		// Both sides produced the file independently.
		case lState == created && rState == created:
			if sameLive(ctx, l, r, opt) {
				act := base
				act.Kind = Copy
				act.Src, act.Dst = Left, Right
				act.SrcPath, act.DstPath = l.Path, r.Path
				act.Reason = because("appearedSame")
				out.Agreed = append(out.Agreed, act)
			} else {
				out.Actions = append(out.Actions, conflictAction(base, because("appearedDiffer")))
			}

		// One side edited, the other did not.
		case lState == modified && rState == unchanged:
			out.Actions = append(out.Actions, copyAction(base, Left, because("changedOnSide", "side", "left")))
		case rState == modified && lState == unchanged:
			out.Actions = append(out.Actions, copyAction(base, Right, because("changedOnSide", "side", "right")))

		// Both edited.
		case lState == modified && rState == modified:
			if sameLive(ctx, l, r, opt) {
				act := base
				act.Kind = Copy
				act.Src, act.Dst = Left, Right
				act.SrcPath, act.DstPath = l.Path, r.Path
				act.Reason = because("changedBothSame")
				out.Agreed = append(out.Agreed, act)
			} else {
				out.Actions = append(out.Actions, conflictAction(base, because("changedBoth")))
			}

		// One side deleted, the other left it alone.
		case lState == deleted && rState == unchanged:
			out.Actions = append(out.Actions, deleteAction(base, Right, because("deletedOnSide", "side", "left")))
		case rState == deleted && lState == unchanged:
			out.Actions = append(out.Actions, deleteAction(base, Left, because("deletedOnSide", "side", "right")))

		// One side deleted while the other edited. An edit is evidence that
		// somebody wanted the file; a deletion is evidence that somebody did
		// not. Only one of those can be undone by hand later, so the edit wins
		// and the file comes back.
		case lState == deleted && rState == modified:
			out.Actions = append(out.Actions, copyAction(base, Right, because("restoredOnSide", "side", "right", "other", "left")))
		case rState == deleted && lState == modified:
			out.Actions = append(out.Actions, copyAction(base, Left, because("restoredOnSide", "side", "left", "other", "right")))

		default:
			return nil, fmt.Errorf("unreachable comparison for %q: left=%v right=%v", p, lState, rState)
		}
	}

	detectRenames(ctx, out)

	if err := checkBrake(out, len(prev), opt); err != nil {
		return nil, err
	}
	return out, nil
}

// settling reports whether a file is still being written to, and should
// therefore be left where it is until the next run.
func settling(l, r *scan.Entry, opt Options) (Reason, bool) {
	if opt.QuietPeriod <= 0 {
		return Reason{}, false
	}
	cutoff := opt.now().Add(-opt.QuietPeriod)
	for side, e := range map[Side]*scan.Entry{Left: l, Right: r} {
		if e == nil || !e.Mod.After(cutoff) {
			continue
		}
		return because("settling", "side", side.String(), "period", opt.QuietPeriod.String()), true
	}
	return Reason{}, false
}

func classify(ctx context.Context, cur *scan.Entry, present, hasPrev bool, prev Facts, opt Options) status {
	switch {
	case !present && !hasPrev:
		return absent
	case !present:
		return deleted
	case !hasPrev:
		return created
	}
	if Same(Facts{cur.Size, cur.Mod, cur.Hash(ctx)}, prev, opt.ModWindow) {
		return unchanged
	}
	return modified
}

func sameLive(ctx context.Context, l, r *scan.Entry, opt Options) bool {
	return Same(Facts{l.Size, l.Mod, l.Hash(ctx)}, Facts{r.Size, r.Mod, r.Hash(ctx)}, opt.ModWindow)
}

func copyAction(base Action, from Side, reason Reason) Action {
	base.Kind = Copy
	base.Src = from
	base.Dst = from.Other()
	base.Reason = reason
	src := base.LeftNow
	if from == Right {
		src = base.RightNow
	}
	// The destination gets the source's own spelling. That is what makes a
	// composed and a decomposed tree converge on one form instead of trading
	// copies back and forth forever.
	base.SrcPath = src.Path
	base.DstPath = src.Path
	return base
}

func deleteAction(base Action, on Side, reason Reason) Action {
	base.Kind = Delete
	base.Dst = on
	base.Reason = reason
	victim := base.LeftNow
	if on == Right {
		victim = base.RightNow
	}
	if victim != nil {
		base.DstPath = victim.Path
	}
	return base
}

func conflictAction(base Action, reason Reason) Action {
	base.Kind = Conflict
	base.Reason = reason
	return base
}

// detectRenames folds a delete plus a copy of identical content into a single
// move.
//
// Without this, renaming a folder of holiday photos on a laptop re-uploads
// every one of them and deletes the originals on the far side. With it, the
// far side does a server-side rename and no bytes cross the wire. It only fires
// when a real hash is available on both the record and the new file, because
// matching by size alone would happily "rename" two unrelated files that happen
// to be the same length.
func detectRenames(ctx context.Context, p *Plan) {
	type key struct {
		size int64
		hash string
	}
	deletions := map[key]int{}
	for i, a := range p.Actions {
		// Only a real deletion on one side can be the other half of a rename.
		// A record cleanup for a path already gone everywhere has no file
		// behind it to move.
		if a.Kind != Delete || a.Prev == nil || (a.LeftNow == nil && a.RightNow == nil) {
			continue
		}
		// The recorded hash is taken from the side where the rename HAPPENED,
		// which is the side opposite the one being told to delete. That side
		// holds both halves of the evidence: the record of what the file used
		// to be, and the live file it has become.
		//
		// Reading the destination's hash instead looks equivalent, because a
		// recorded agreement means both sides held the same content. It is not
		// equivalent when the destination cannot produce a hash at all: an SFTP
		// host with no remote shell records an empty one, and every rename then
		// degrades into a full re-upload plus a delete. Found by running a job
		// against a real SFTP server for the first time, where renaming one
		// file reported "0 moved, 1 copied".
		h, size := a.Prev.RightHash, a.Prev.RightSize
		if a.Dst == Right {
			h, size = a.Prev.LeftHash, a.Prev.LeftSize
		}
		// Matching on size alone would happily "rename" two unrelated files
		// that happen to be the same length, so a job where NEITHER side can
		// hash simply gets no rename detection: a copy and a delete are slower
		// but correct.
		if h == "" {
			continue
		}
		deletions[key{size, h}] = i
	}
	if len(deletions) == 0 {
		return
	}

	removed := map[int]bool{}
	for i := range p.Actions {
		a := p.Actions[i]
		if a.Kind != Copy {
			continue
		}
		src := a.LeftNow
		if a.Src == Right {
			src = a.RightNow
		}
		if src == nil {
			continue
		}
		h := src.Hash(ctx)
		if h == "" {
			continue
		}
		j, ok := deletions[key{src.Size, h}]
		if !ok || removed[j] || p.Actions[j].Dst != a.Dst {
			continue
		}
		// The far side must move the file from where it used to be to where
		// it now is on the source side.
		p.Actions[i] = Action{
			Kind:       Move,
			Path:       a.Path,
			Src:        a.Src,
			Dst:        a.Dst,
			SrcPath:    src.Path,
			DstPath:    src.Path,
			OldDstPath: p.Actions[j].DstPath,
			Reason:     because("renamedOnSide", "side", a.Src.String()),
			LeftNow:    a.LeftNow,
			RightNow:   a.RightNow,
			Prev:       p.Actions[j].Prev,
		}
		removed[j] = true
		delete(deletions, key{src.Size, h})
	}

	if len(removed) == 0 {
		return
	}
	kept := p.Actions[:0]
	for i, a := range p.Actions {
		if removed[i] {
			continue
		}
		kept = append(kept, a)
	}
	p.Actions = kept
}

func checkBrake(p *Plan, known int, opt Options) error {
	if opt.BrakePercent <= 0 || known == 0 {
		return nil
	}
	var deletes int
	var sample []string
	for _, a := range p.Actions {
		// A record cleanup for a file already gone on both sides destroys
		// nothing, so it must not count towards the brake.
		if a.Kind != Delete || (a.LeftNow == nil && a.RightNow == nil) {
			continue
		}
		deletes++
		if len(sample) < 5 {
			sample = append(sample, a.Path)
		}
	}
	if deletes <= opt.BrakeFloor {
		return nil
	}
	if deletes*100 <= known*opt.BrakePercent {
		return nil
	}
	return &BrakeError{Deletes: deletes, Known: known, Percent: opt.BrakePercent, Sample: sample}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// DirKind is what a directory action does.
type DirKind int

// Directories only ever appear or disappear; they have no content to compare.
const (
	MakeDir DirKind = iota
	RemoveDir
	RecordDir // already on both sides, only the record needs writing
)

func (k DirKind) String() string {
	switch k {
	case MakeDir:
		return "mkdir"
	case RemoveDir:
		return "rmdir"
	default:
		return "record"
	}
}

// DirAction is one directory to create, remove or merely record.
type DirAction struct {
	Kind    DirKind
	Path    string // matching key
	DstPath string // the name to operate on, on the destination side
	Dst     Side
	Reason  Reason

	// LeftPath and RightPath are the names each side ends up holding, which can
	// differ in spelling for the same reason file names can.
	LeftPath  string
	RightPath string
}

// BuildDirs compares the directory listings the same way files are compared.
//
// This exists only for EMPTY directories. A directory holding files is implied
// by the files and needs no help. An empty one has nothing to imply it, so
// without a record of its own it can never be created on the far side, and a
// project skeleton or a photo folder waiting to be filled quietly fails to
// travel.
//
// The record is what makes removal safe. Without it, "this folder is not over
// there" is ambiguous in exactly the way a missing file is: it could be a
// deletion to propagate or a folder that has simply never existed on that side.
// Removal also goes through Rmdir rather than a recursive delete, so a
// directory that still holds anything refuses to go, and that refusal is
// reported instead of being forced.
func BuildDirs(left, right *scan.Listing, prev map[string]state.Dir) []DirAction {
	if left.Dirs == nil || right.Dirs == nil {
		return nil
	}

	keys := make(map[string]struct{}, len(left.Dirs)+len(right.Dirs)+len(prev))
	for k := range left.Dirs {
		keys[k] = struct{}{}
	}
	for k := range right.Dirs {
		keys[k] = struct{}{}
	}
	for k := range prev {
		keys[k] = struct{}{}
	}

	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)

	var out []DirAction
	for _, k := range ordered {
		lName, onLeft := left.Dirs[k]
		rName, onRight := right.Dirs[k]
		_, known := prev[k]

		switch {
		case onLeft && onRight:
			out = append(out, DirAction{Kind: RecordDir, Path: k, LeftPath: lName, RightPath: rName, Reason: because("dirBoth")})
		case onLeft && !known:
			out = append(out, DirAction{Kind: MakeDir, Path: k, DstPath: lName, Dst: Right,
				LeftPath: lName, RightPath: lName, Reason: because("dirNewOnSide", "side", "left")})
		case onRight && !known:
			out = append(out, DirAction{Kind: MakeDir, Path: k, DstPath: rName, Dst: Left,
				LeftPath: rName, RightPath: rName, Reason: because("dirNewOnSide", "side", "right")})
		case onLeft && known:
			out = append(out, DirAction{Kind: RemoveDir, Path: k, DstPath: lName, Dst: Left, Reason: because("dirRemovedOnSide", "side", "right")})
		case onRight && known:
			out = append(out, DirAction{Kind: RemoveDir, Path: k, DstPath: rName, Dst: Right, Reason: because("dirRemovedOnSide", "side", "left")})
		default:
			// Known before, gone from both sides. Only the record is left.
			out = append(out, DirAction{Kind: RemoveDir, Path: k, Reason: because("dirGoneBoth")})
		}
	}

	// Create shallow directories before deep ones, and remove deep ones before
	// their parents. Rmdir refuses a directory that still has a child in it, so
	// the wrong order would turn every nested removal into a reported failure.
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := out[i].Kind == RemoveDir, out[j].Kind == RemoveDir
		if ri != rj {
			return !ri
		}
		if ri {
			return depth(out[i].Path) > depth(out[j].Path)
		}
		return depth(out[i].Path) < depth(out[j].Path)
	})
	return out
}

func depth(p string) int { return strings.Count(p, "/") }
