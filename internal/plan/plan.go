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
	"time"

	"github.com/junkerderprovinz/reeveroll/internal/scan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

// Side names one end of a sync job.
type Side int

// The two ends. Left is conventionally the local side, but nothing in the
// engine depends on that.
const (
	Left Side = iota
	Right
)

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

// The four things that can happen to a file.
const (
	Copy     Kind = iota // bring one side's version over to the other
	Delete               // remove on one side because the other side removed it
	Move                 // apply a rename the other side made
	Conflict             // both sides changed it differently, keep both
)

func (k Kind) String() string {
	switch k {
	case Copy:
		return "copy"
	case Delete:
		return "delete"
	case Move:
		return "move"
	default:
		return "conflict"
	}
}

// Action is one change to make.
type Action struct {
	Kind    Kind
	Path    string // the path the action results in
	OldPath string // Move only: where the file is now on Dst
	Src     Side   // Copy: where the content comes from
	Dst     Side   // where the change lands. Conflict touches both sides.
	Reason  string

	LeftNow  *scan.Entry
	RightNow *scan.Entry
	Prev     *state.Entry
}

// Plan is the full set of changes for one run.
type Plan struct {
	Actions   []Action
	Unchanged int
	// Agreed lists paths that need no work but whose state row should be
	// written, because both sides produced the same file independently.
	Agreed []Action
}

// Options tunes comparison and the safety brakes.
type Options struct {
	// ModWindow is how far two modification times may differ and still count
	// as the same instant. Filesystems disagree wildly here: exFAT stores two
	// second resolution, S3 keeps whatever was put in the metadata. Two
	// seconds is the traditional rsync value. It only ever applies when at
	// least one side cannot produce a hash, because a hash comparison is
	// exact and needs no window.
	ModWindow time.Duration

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
	return Options{ModWindow: 2 * time.Second, BrakePercent: 50, BrakeFloor: 10}
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

type facts = Facts

func same(a, b Facts, window time.Duration) bool { return Same(a, b, window) }

// Build compares both sides against the last agreed state.
func Build(ctx context.Context, left, right scan.Side, prev map[string]state.Entry, opt Options) (*Plan, error) {
	if len(prev) > 0 {
		if len(left) == 0 {
			return nil, &EmptySideError{Side: Left, Known: len(prev)}
		}
		if len(right) == 0 {
			return nil, &EmptySideError{Side: Right, Known: len(prev)}
		}
	}

	paths := make(map[string]struct{}, len(left)+len(right)+len(prev))
	for p := range left {
		paths[p] = struct{}{}
	}
	for p := range right {
		paths[p] = struct{}{}
	}
	for p := range prev {
		paths[p] = struct{}{}
	}

	ordered := make([]string, 0, len(paths))
	for p := range paths {
		ordered = append(ordered, p)
	}
	sort.Strings(ordered)

	out := &Plan{}
	for _, p := range ordered {
		l, hasL := left[p]
		r, hasR := right[p]
		s, hasPrev := prev[p]

		lState := classify(ctx, l, hasL, hasPrev, facts{s.LeftSize, s.LeftMod, s.LeftHash}, opt)
		rState := classify(ctx, r, hasR, hasPrev, facts{s.RightSize, s.RightMod, s.RightHash}, opt)

		var prevPtr *state.Entry
		if hasPrev {
			copyOf := s
			prevPtr = &copyOf
		}
		base := Action{Path: p, LeftNow: l, RightNow: r, Prev: prevPtr}

		switch {
		// Nothing to do.
		case lState == unchanged && rState == unchanged:
			out.Unchanged++

		// Both sides forgot about it. Drop the row.
		case lState == deleted && rState == deleted:
			act := base
			act.Kind = Delete
			act.Dst = Left // no side is touched; apply only clears the state row
			act.Reason = "gone on both sides, dropping the record"
			act.LeftNow, act.RightNow = nil, nil
			out.Actions = append(out.Actions, act)

		// One side has it and nothing was ever agreed: a plain new file.
		case lState == created && rState == absent:
			out.Actions = append(out.Actions, copyAction(base, Left, "new on the left"))
		case rState == created && lState == absent:
			out.Actions = append(out.Actions, copyAction(base, Right, "new on the right"))

		// Both sides produced the file independently.
		case lState == created && rState == created:
			if sameLive(ctx, l, r, opt) {
				act := base
				act.Kind = Copy
				act.Src, act.Dst = Left, Right
				act.Reason = "appeared on both sides with identical content"
				out.Agreed = append(out.Agreed, act)
			} else {
				out.Actions = append(out.Actions, conflictAction(base, "appeared on both sides with different content"))
			}

		// One side edited, the other did not.
		case lState == modified && rState == unchanged:
			out.Actions = append(out.Actions, copyAction(base, Left, "changed on the left"))
		case rState == modified && lState == unchanged:
			out.Actions = append(out.Actions, copyAction(base, Right, "changed on the right"))

		// Both edited.
		case lState == modified && rState == modified:
			if sameLive(ctx, l, r, opt) {
				act := base
				act.Kind = Copy
				act.Src, act.Dst = Left, Right
				act.Reason = "changed on both sides to the same content"
				out.Agreed = append(out.Agreed, act)
			} else {
				out.Actions = append(out.Actions, conflictAction(base, "changed on both sides"))
			}

		// One side deleted, the other left it alone.
		case lState == deleted && rState == unchanged:
			out.Actions = append(out.Actions, deleteAction(base, Right, "deleted on the left"))
		case rState == deleted && lState == unchanged:
			out.Actions = append(out.Actions, deleteAction(base, Left, "deleted on the right"))

		// One side deleted while the other edited. An edit is evidence that
		// somebody wanted the file; a deletion is evidence that somebody did
		// not. Only one of those can be undone by hand later, so the edit wins
		// and the file comes back.
		case lState == deleted && rState == modified:
			out.Actions = append(out.Actions, copyAction(base, Right, "edited on the right after being deleted on the left, restoring it"))
		case rState == deleted && lState == modified:
			out.Actions = append(out.Actions, copyAction(base, Left, "edited on the left after being deleted on the right, restoring it"))

		default:
			return nil, fmt.Errorf("unreachable comparison for %q: left=%v right=%v", p, lState, rState)
		}
	}

	detectRenames(ctx, out, opt)

	if err := checkBrake(out, len(prev), opt); err != nil {
		return nil, err
	}
	return out, nil
}

func classify(ctx context.Context, cur *scan.Entry, present, hasPrev bool, prev facts, opt Options) status {
	switch {
	case !present && !hasPrev:
		return absent
	case !present:
		return deleted
	case !hasPrev:
		return created
	}
	if same(facts{cur.Size, cur.Mod, cur.Hash(ctx)}, prev, opt.ModWindow) {
		return unchanged
	}
	return modified
}

func sameLive(ctx context.Context, l, r *scan.Entry, opt Options) bool {
	return same(facts{l.Size, l.Mod, l.Hash(ctx)}, facts{r.Size, r.Mod, r.Hash(ctx)}, opt.ModWindow)
}

func copyAction(base Action, from Side, reason string) Action {
	base.Kind = Copy
	base.Src = from
	base.Dst = from.Other()
	base.Reason = reason
	return base
}

func deleteAction(base Action, on Side, reason string) Action {
	base.Kind = Delete
	base.Dst = on
	base.Reason = reason
	return base
}

func conflictAction(base Action, reason string) Action {
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
func detectRenames(ctx context.Context, p *Plan, opt Options) {
	type key struct {
		size int64
		hash string
	}
	// Deletions on side D that came from a disappearance on the other side.
	deletions := map[key]int{}
	for i, a := range p.Actions {
		// Only a real deletion on one side can be the other half of a rename.
		// A record cleanup for a path already gone everywhere has no file
		// behind it to move.
		if a.Kind != Delete || a.Prev == nil || (a.LeftNow == nil && a.RightNow == nil) {
			continue
		}
		// The file about to disappear is the one on the destination side, so
		// that is the recorded hash to match against.
		h, size := a.Prev.LeftHash, a.Prev.LeftSize
		if a.Dst == Right {
			h, size = a.Prev.RightHash, a.Prev.RightSize
		}
		// Matching on size alone would happily "rename" two unrelated files
		// that happen to be the same length, so a hashless backend simply gets
		// no rename detection: a copy and a delete are slower but correct.
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
			Kind:     Move,
			Path:     a.Path,
			OldPath:  p.Actions[j].Path,
			Src:      a.Src,
			Dst:      a.Dst,
			Reason:   fmt.Sprintf("renamed on the %s side", a.Src),
			LeftNow:  a.LeftNow,
			RightNow: a.RightNow,
			Prev:     p.Actions[j].Prev,
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
