// Package plan turns "what both sides look like now" plus "what they agreed on
// last time" into an ordered list of actions, without touching anything.
//
// The plan is built separately from applying it, so it can be shown to the
// user before anything moves and the safety brakes can be measured against it.
package plan

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
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

// Reason is why an action or skip happens, as the English sentence the command
// line and the log print and as a code with values that an interface can
// translate. Translating here would tie the log to whichever language a reader
// last used.
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

	// Reasons found while running rather than while deciding. They carry the
	// backend's own error as a value.
	"stepFailed":      "{what} failed, leaving it for the next run: {error}",
	"removeDirFailed": "could not remove the folder, leaving it: {error}",
	"heldOpen":        "held open by another program on the {side} side, waiting for it to be closed",
	"heldOpenDuring":  "held open by another program while {what} was running, leaving it for the next run: {error}",
	"heldOpenAdmin":   "held open by another program on the {side} side; running with administrator rights, as a service, ArrowLoop would copy it from a shadow copy",
	"snapshotFailed":  "held open by another program on the {side} side, and no shadow copy could be taken to read it from: {error}",
	"unverified":      "{what} finished, but the {side} side could not produce a checksum and this job insists on one; leaving it for the next run",
	"changedDuring":   "changed on the {side} side while this run was going, leaving it for the next run",
	"unsupported":     "{kind} on the {side} side, which this engine does not carry",
	"sealed":          "locked on the {side} side: OneDrive hands its Personal Vault to no app, so this folder is left out",
	"unreadable":      "could not be read on the {side} side, so this run leaves the folder alone on both sides",
	"vanished":        "disappeared from the {side} side while it was being read, so this run leaves the folder alone on both sides",
	"recordFailed":    "the record could not be written, leaving it for the next run: {error}",
	"oneWay":          "this job only writes away from the {side}, so the {side} version is the one that stands",
	"conflictGone":    "one of the two versions is gone, so there is nothing left to decide",
	"takenBack":       "taken back from the {side}, after a safety brake refused the change",
}

// String is the English sentence, so %s and %v print the sentence rather than
// the struct.
func (r Reason) String() string { return r.Text }

// Because builds a reason from a code and its values, for the stages that
// discover one while running rather than while deciding.
func Because(code string, pairs ...string) Reason { return because(code, pairs...) }

// because builds a reason from a code and alternating keys and values. A code
// without wording falls back to the code itself, so a missing sentence shows
// instead of printing nothing.
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
	// one, as a job in Move mode does. Being one action, the removal cannot
	// run unless the copy succeeded, and a preview shows one line.
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

// Action is one change to make. Path is the matching key and is never handed
// to a backend; SrcPath, DstPath and OldDstPath are the names as each side
// spells them.
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

	// Resolve applies only to a conflict. Its zero value is KeepBoth, which is
	// what an unattended run does unless the job lets the newer version win.
	Resolve Resolution

	// Aside applies only to a Relocate: the destination's version is moved to
	// a conflict name before the copy lands, because it lives nowhere else.
	Aside bool
}

// Resolution is what to do with the two versions of a file that disagree.
type Resolution int

const (
	// KeepBoth gives the newer version the plain name on both sides and keeps
	// the older one beside it.
	KeepBoth Resolution = iota
	// KeepLeft and KeepRight are set by a person or by NewerWins. The losing
	// version still goes to the trash.
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

// ParseResolution reads what a person picked. Anything unrecognised keeps both
// versions, so an older engine never guesses at a newer interface's choice.
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

// Skip is a path the run left alone, with the reason. It is postponed work:
// the state row stays untouched so the next run reconsiders it.
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
	Agreed []Action
	// Forget lists keys whose state row goes while both sides stay as they
	// are, such as a file a one-way job leaves on the destination after the
	// source deleted it.
	Forget  []string
	Skipped []Skip
	// PassedOver lists folders a side never lets the job open, such as
	// OneDrive's Personal Vault. Unlike a skip it is not postponed: no later
	// run will get further, so a run does not count it as left for later.
	PassedOver []Skip
	// Dirs is empty unless the job syncs empty directories, which needs both
	// sides to be able to hold one.
	Dirs []DirAction
}

// Options is the per-job settings shared by the comparison and the apply stage.
type Options struct {
	// Direction is which way this job may write. The zero value is both ways.
	Direction Direction

	// Mode is what a one-way job does beyond copying: nothing, mirror, or
	// move. The zero value is ModeSync, which deletes nothing on its own.
	Mode Mode

	// Transfers is how many files may be copied at the same time.
	Transfers int

	// ModWindow is how far two modification times may differ and still count
	// as the same instant (exFAT stores two-second resolution). It only
	// applies when a side cannot produce a hash.
	ModWindow time.Duration

	// QuietPeriod is how long a file has to sit unchanged before the engine
	// touches it, so a file still being saved is not copied half-written.
	QuietPeriod time.Duration

	// Now is the reference point for QuietPeriod. Zero means time.Now.
	Now time.Time

	// FoldCase records whether this job matches names case-insensitively,
	// derived from the two backends (see pathid.Key).
	FoldCase bool

	// BrakePercent trips the mass-delete brake when a single run would delete
	// more than this share of the known files. Zero disables the brake.
	BrakePercent int

	// ChangePercent trips the mass-change brake when a single run would
	// overwrite more than this share of the known files, which is what a tree
	// encrypted in place looks like. Zero disables the brake.
	ChangePercent int

	// BrakeFloor is a number of deletions, or of overwrites, at or below which
	// neither brake trips, so a tiny job is not blocked by its own arithmetic.
	BrakeFloor int

	// Approved holds the marks of changes a brake refused and somebody then
	// allowed. A brake lets a plan with one of these marks through, so the
	// approval covers what was shown and nothing that happened since.
	Approved []string

	// Unbraked plans past every brake, for the run that takes a refused
	// change back. It destroys nothing, so there is nothing to brake.
	Unbraked bool

	// NewerWins decides a conflict for the version changed last, as if a
	// person had picked it, so the other goes to the trash. Two times within
	// ModWindow of each other cannot be told apart and keep both.
	NewerWins bool
}

// DefaultOptions is what the command line uses when nothing is given.
func DefaultOptions() Options {
	return Options{
		Transfers:     4,
		ModWindow:     2 * time.Second,
		QuietPeriod:   5 * time.Second,
		BrakePercent:  50,
		ChangePercent: 50,
		BrakeFloor:    10,
	}
}

func (o Options) now() time.Time {
	if o.Now.IsZero() {
		return time.Now()
	}
	return o.Now
}

// Brake names the safety brake that refused a run.
type Brake string

// The three brakes. An emptied side is its own brake because nothing can be
// planned against it.
const (
	BrakeDelete Brake = "delete"
	BrakeChange Brake = "change"
	BrakeEmpty  Brake = "empty"
)

// BrakeError is returned when a run would delete or overwrite an implausible
// share of the tree. It carries enough detail for the user to judge the
// refusal.
type BrakeError struct {
	Kind    Brake
	Count   int
	Known   int
	Percent int
	Sample  []string

	// Paths names every file the brake counted, as the side about to be
	// written calls it. OnLeft and OnRight say how many of them each side
	// would lose or have overwritten.
	Paths   []string
	OnLeft  int
	OnRight int

	// Mark identifies exactly this set of changes; see Options.Approved.
	Mark string
}

func (e *BrakeError) Error() string {
	share := e.Count * 100 / max(e.Known, 1)
	if e.Kind == BrakeChange {
		return fmt.Sprintf("mass-change brake: this run would overwrite %d of %d known files (%d%%, limit %d%%); first paths: %v",
			e.Count, e.Known, share, e.Percent, e.Sample)
	}
	return fmt.Sprintf("mass-delete brake: this run would delete %d of %d known files (%d%%, limit %d%%); first paths: %v",
		e.Count, e.Known, share, e.Percent, e.Sample)
}

// EmptySideError is returned when a side lists nothing while the state says it
// used to hold files, or while it is the source of a mirror whose destination
// holds some. A disk that failed to mount lists empty, and believing it would
// delete everything on the other side.
type EmptySideError struct {
	Side  Side
	Known int
	// Held is what the other side holds, given when there is no record.
	Held int
}

func (e *EmptySideError) Error() string {
	if e.Known == 0 {
		return fmt.Sprintf("the %s side lists no files at all, and mirroring it would delete the %d files on the %s side; refusing (is it mounted?)",
			e.Side, e.Held, e.Side.Other())
	}
	return fmt.Sprintf("the %s side lists no files at all, but %d were known there last time; refusing to treat this as a deletion (is it mounted?)",
		e.Side, e.Known)
}

// Mark identifies this refusal; see Options.Approved.
func (e *EmptySideError) Mark() string {
	return fmt.Sprintf("empty:%s:%d:%d", e.Side, e.Known, e.Held)
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

// Facts is the minimum needed to compare two versions of a file. The apply
// stage uses the same comparison to check that two sides ended up equal.
type Facts struct {
	Size int64
	Mod  time.Time
	Hash string
}

// Same reports whether two versions of a file are the same content. When both
// have a hash the modification time is ignored, so two edits within the window
// that keep the length are still told apart.
func Same(a, b Facts, window time.Duration) bool {
	if a.Hash != "" && b.Hash != "" {
		return a.Size == b.Size && a.Hash == b.Hash
	}
	// Google Drive reports -1 for a native document it exports on the fly, so
	// for that side the time is all there is to compare.
	if a.Size != b.Size && a.Size >= 0 && b.Size >= 0 {
		return false
	}
	diff := a.Mod.Sub(b.Mod)
	if diff < 0 {
		diff = -diff
	}
	return diff <= window
}

// Build compares both sides against the last agreed state. For a one-way job it
// rewrites the result to write only away from the source.
func Build(ctx context.Context, left, right *scan.Listing, prev map[string]state.Entry, opt Options) (*Plan, error) {
	mirror := opt.Direction != Both && opt.Mode == ModeMirror
	from, to := left, right
	if opt.Direction.source() == Right {
		from, to = right, left
	}
	// An emptied side somebody accepted deletes everything on the other one,
	// which is what they were shown, so the brakes stay out of that run too.
	emptied := emptySide(left, right, from, to, len(prev), mirror, opt.Direction)
	if emptied != nil && !opt.Unbraked {
		if !slices.Contains(opt.Approved, emptied.Mark()) {
			return nil, emptied
		}
		opt.Unbraked = true
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

	for i, p := range ordered {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		scan.Report(ctx, scan.Reading{Stage: scan.StageCompare, Done: i, Total: len(ordered)})
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
			if sameLive(ctx, l, r, opt, false) {
				act := base
				act.Kind = Copy
				act.Src, act.Dst = Left, Right
				act.SrcPath, act.DstPath = l.Path, r.Path
				act.Reason = because("appearedSame")
				out.Agreed = append(out.Agreed, act)
			} else {
				out.Actions = append(out.Actions, conflictAction(base, because("appearedDiffer"), opt))
			}

		// One side edited, the other did not.
		case lState == modified && rState == unchanged:
			out.Actions = append(out.Actions, copyAction(base, Left, because("changedOnSide", "side", "left")))
		case rState == modified && lState == unchanged:
			out.Actions = append(out.Actions, copyAction(base, Right, because("changedOnSide", "side", "right")))

		// Both edited.
		case lState == modified && rState == modified:
			if sameLive(ctx, l, r, opt, true) {
				act := base
				act.Kind = Copy
				act.Src, act.Dst = Left, Right
				act.SrcPath, act.DstPath = l.Path, r.Path
				act.Reason = because("changedBothSame")
				out.Agreed = append(out.Agreed, act)
			} else {
				out.Actions = append(out.Actions, conflictAction(base, because("changedBoth"), opt))
			}

		// One side deleted, the other left it alone.
		case lState == deleted && rState == unchanged:
			out.Actions = append(out.Actions, deleteAction(base, Right, because("deletedOnSide", "side", "left")))
		case rState == deleted && lState == unchanged:
			out.Actions = append(out.Actions, deleteAction(base, Left, because("deletedOnSide", "side", "right")))

		// One side deleted while the other edited. The edit wins, because a
		// restored file can be deleted again by hand but a lost edit cannot
		// be recovered.
		case lState == deleted && rState == modified:
			out.Actions = append(out.Actions, copyAction(base, Right, because("restoredOnSide", "side", "right", "other", "left")))
		case rState == deleted && lState == modified:
			out.Actions = append(out.Actions, copyAction(base, Left, because("restoredOnSide", "side", "left", "other", "right")))

		default:
			return nil, fmt.Errorf("unreachable comparison for %q: left=%v right=%v", p, lState, rState)
		}
	}

	detectRenames(ctx, out, opt.Direction)
	enforce(ctx, out, opt.Direction, opt.Mode)

	// The brake weighs the plan after enforce, which adds a mirror's
	// deletions. With no record yet, a mirror weighs them against what the
	// destination holds.
	known := len(prev)
	if known == 0 && mirror {
		known = len(to.Files)
	}
	if err := checkBrakes(out, known, opt); err != nil {
		return nil, err
	}
	return out, nil
}

// emptySide reports a side that lists nothing where files are expected, or nil.
func emptySide(left, right, from, to *scan.Listing, known int, mirror bool, dir Direction) *EmptySideError {
	if known > 0 {
		if len(left.Files) == 0 {
			return &EmptySideError{Side: Left, Known: known}
		}
		if len(right.Files) == 0 {
			return &EmptySideError{Side: Right, Known: known}
		}
	}
	if mirror && len(from.Files) == 0 && len(to.Files) > 0 {
		return &EmptySideError{Side: dir.source(), Held: len(to.Files)}
	}
	return nil
}

// settling reports whether a file is still being written to, and should
// therefore be left where it is until the next run.
func settling(l, r *scan.Entry, opt Options) (Reason, bool) {
	if opt.QuietPeriod <= 0 {
		return Reason{}, false
	}
	now := opt.now()
	cutoff := now.Add(-opt.QuietPeriod)
	// A time further ahead than a clock a little fast would put it comes from
	// a wrong clock, and waiting for it would postpone the file until then.
	horizon := now.Add(opt.QuietPeriod)
	for side, e := range map[Side]*scan.Entry{Left: l, Right: r} {
		if e == nil || !e.Mod.After(cutoff) || e.Mod.After(horizon) {
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
	window := opt.ModWindow
	if p, ok := cur.TimePrecision(); ok {
		window = p
	}
	if Same(Facts{cur.Size, cur.Mod, cur.CheapHash(ctx)}, prev, window) {
		return unchanged
	}
	// Only a file whose time moved while its size did not is read for its
	// checksum; reading every file on every run would read a whole disk.
	if cur.Size == prev.Size && prev.Hash != "" {
		if sum := cur.Hash(ctx); sum != "" && sum == prev.Hash {
			return unchanged
		}
	}
	return modified
}

// sameLive compares the two sides as they are now. Careful is for two edits
// since the last run, where a wrong "same" would lose one of them, so equal
// sizes are always settled by checksum; the first meeting of two trees is
// settled by size and time, or matching a full disk would read it twice.
func sameLive(ctx context.Context, l, r *scan.Entry, opt Options, careful bool) bool {
	if l.Size != r.Size {
		return false
	}
	if !careful && Same(Facts{l.Size, l.Mod, l.CheapHash(ctx)}, Facts{r.Size, r.Mod, r.CheapHash(ctx)}, opt.ModWindow) {
		return true
	}
	lsum, rsum := l.Hash(ctx), r.Hash(ctx)
	if lsum == "" || rsum == "" {
		// A backend without checksums leaves only size and time.
		return Same(Facts{Size: l.Size, Mod: l.Mod}, Facts{Size: r.Size, Mod: r.Mod}, opt.ModWindow)
	}
	return lsum == rsum
}

func copyAction(base Action, from Side, reason Reason) Action {
	base.Kind = Copy
	base.Src = from
	base.Dst = from.Other()
	base.Reason = reason
	src, there := base.LeftNow, base.RightNow
	if from == Right {
		src, there = base.RightNow, base.LeftNow
	}
	base.SrcPath = src.Path
	base.DstPath = target(src, there)
	return base
}

// target is the name a copy writes to. A new file takes the source's spelling,
// so both sides converge on one Unicode form. A file the destination already
// holds keeps its name there: written under another spelling it would sit
// beside the old one, and the two would collide on the next scan.
func target(src, there *scan.Entry) string {
	if there != nil {
		return there.Path
	}
	return src.Path
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

func conflictAction(base Action, reason Reason, opt Options) Action {
	base.Kind = Conflict
	base.Reason = reason
	if opt.NewerWins {
		base.Resolve = newer(base.LeftNow, base.RightNow, opt.ModWindow)
	}
	return base
}

func newer(l, r *scan.Entry, window time.Duration) Resolution {
	switch diff := l.Mod.Sub(r.Mod); {
	case diff > window:
		return KeepLeft
	case -diff > window:
		return KeepRight
	}
	return KeepBoth
}

// detectRenames folds a delete plus a copy of identical content into a single
// move, so a renamed folder is renamed on the far side instead of uploaded
// again. It needs a hash on both the record and the new file, since equal
// sizes alone would pair up unrelated files.
//
// A rename on the destination of a one-way job is not folded: Enforce restores
// the deleted name from the source, which it cannot do once the deletion has
// become part of a move towards the source.
func detectRenames(ctx context.Context, p *Plan, dir Direction) {
	type key struct {
		size int64
		hash string
	}
	deletions := map[key]int{}
	for i, a := range p.Actions {
		// A record cleanup for a path gone on both sides has no file to move.
		if a.Kind != Delete || a.Prev == nil || (a.LeftNow == nil && a.RightNow == nil) {
			continue
		}
		if dir != Both && a.Dst == dir.source() {
			continue
		}
		// The recorded hash comes from the side where the rename happened,
		// opposite the deletion. The deleting side may be a backend that
		// records no hash, such as SFTP without a remote shell.
		h, size := a.Prev.RightHash, a.Prev.RightSize
		if a.Dst == Right {
			h, size = a.Prev.LeftHash, a.Prev.LeftSize
		}
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

// checkBrakes weighs the plan against both brakes, deletions first, since they
// are the ones a trash has to catch.
func checkBrakes(p *Plan, known int, opt Options) error {
	if opt.Unbraked || known == 0 {
		return nil
	}
	for _, brake := range []struct {
		kind    Brake
		percent int
	}{{BrakeDelete, opt.BrakePercent}, {BrakeChange, opt.ChangePercent}} {
		if brake.percent <= 0 {
			continue
		}
		e := weigh(p, brake.kind)
		if e.Count <= opt.BrakeFloor || e.Count*100 <= known*brake.percent || slices.Contains(opt.Approved, e.Mark) {
			continue
		}
		e.Known, e.Percent = known, brake.percent
		return e
	}
	return nil
}

// counts reports whether a brake counts an action. A record cleanup for a file
// gone on both sides destroys nothing, and a rename loses no content, so only
// a copy onto a file the destination already holds counts as a change.
func counts(a Action, kind Brake) bool {
	switch kind {
	case BrakeDelete:
		return a.Kind == Delete && (a.LeftNow != nil || a.RightNow != nil)
	case BrakeChange:
		return a.Kind == Copy && a.there() != nil
	}
	return false
}

// there is what the side an action writes to holds right now.
func (a Action) there() *scan.Entry {
	if a.Dst == Left {
		return a.LeftNow
	}
	return a.RightNow
}

// weigh collects what one brake counts in a plan.
func weigh(p *Plan, kind Brake) *BrakeError {
	e := &BrakeError{Kind: kind}
	sum := sha256.New()
	fmt.Fprintf(sum, "%s\n", kind)
	for _, a := range p.Actions {
		if !counts(a, kind) {
			continue
		}
		e.Count++
		if a.Dst == Left {
			e.OnLeft++
		} else {
			e.OnRight++
		}
		if len(e.Sample) < 5 {
			e.Sample = append(e.Sample, a.Path)
		}
		e.Paths = append(e.Paths, a.DstPath)
		// Actions come in path order, so the same set always sums the same.
		fmt.Fprintf(sum, "%s\x00%s\n", a.Dst, a.Path)
	}
	e.Mark = hex.EncodeToString(sum.Sum(nil)[:12])
	return e
}

// TakeBack turns what a brake refused into its opposite and drops everything
// else: a file one side lost is copied back from the other, and a file one side
// changed gets the other side's version again. The rest of the run is left to
// the next one, which finds nothing of this left to do.
func TakeBack(p *Plan, kind Brake) *Plan {
	if kind == BrakeEmpty {
		// An emptied side reads as every file deleted there.
		kind = BrakeDelete
	}
	out := &Plan{}
	for _, a := range p.Actions {
		if !counts(a, kind) {
			continue
		}
		had, lost := a.Dst, a.Dst.Other()
		back := Action{
			Kind:     Copy,
			Path:     a.Path,
			Src:      had,
			Dst:      lost,
			SrcPath:  a.DstPath,
			DstPath:  a.DstPath,
			Reason:   because("takenBack", "side", had.String()),
			LeftNow:  a.LeftNow,
			RightNow: a.RightNow,
			Prev:     a.Prev,
		}
		// Where the other side still holds the file, or last called it
		// something else, it keeps that name.
		switch {
		case back.there() != nil:
			back.DstPath = back.there().Path
		case a.Prev != nil && lost == Left && a.Prev.LeftPath != "":
			back.DstPath = a.Prev.LeftPath
		case a.Prev != nil && lost == Right && a.Prev.RightPath != "":
			back.DstPath = a.Prev.RightPath
		}
		out.Actions = append(out.Actions, back)
	}
	return out
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

	// LeftPath and RightPath are the names each side ends up holding.
	LeftPath  string
	RightPath string
}

// BuildDirs compares the directory listings the same way files are compared.
// It matters for empty directories, which no file implies. Removal goes
// through Rmdir rather than a recursive delete, so a directory that still
// holds anything refuses to go and the refusal is reported.
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

	// Create shallow directories first and remove deep ones first, since Rmdir
	// refuses a directory that still has a child.
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
