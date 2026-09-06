package plan

// Which way a job is allowed to write.
//
// The engine always compares both sides, because comparing is how it knows what
// changed. What a direction changes is what it is allowed to DO with the answer:
// one side becomes the source and is never written to, and every proposed action
// is rewritten to run the other way or dropped.
//
// Rewritten rather than filtered, and the difference matters. Filtering would
// leave a job that never converges: the far side's own edit would simply be
// skipped, reported again on the next run, and again for ever. Rewriting says
// what a one-way job actually means, which is that the source is right and the
// destination is made to agree with it.
type Direction int

const (
	// Both ways, which is what this program is for. A conflict is a real
	// conflict and both versions are kept.
	Both Direction = iota
	// Left is the source and only the right side is written to.
	LeftToRight
	// Right is the source and only the left side is written to.
	RightToLeft
)

func (d Direction) String() string {
	switch d {
	case LeftToRight:
		return "left to right"
	case RightToLeft:
		return "right to left"
	default:
		return "both ways"
	}
}

// ParseDirection reads what a person picked.
//
// Anything unrecognised is two ways, which is the safe answer rather than an
// error: a newer interface asking an older engine for a direction it has never
// heard of must keep both sides intact, not refuse the run and not guess at a
// side to overwrite.
func ParseDirection(text string) Direction {
	switch text {
	case "leftToRight", "left to right":
		return LeftToRight
	case "rightToLeft", "right to left":
		return RightToLeft
	default:
		return Both
	}
}

// source is the side a direction reads from and never writes to.
func (d Direction) source() Side {
	if d == RightToLeft {
		return Right
	}
	return Left
}

// Enforce rewrites a plan so that it only ever writes to one side.
//
// The rules, and every one of them follows from "the source is right":
//
//   - A copy TOWARDS the source means the destination changed. The change is
//     undone by copying the source's version over it.
//   - A delete ON the source means the destination deleted something the source
//     still has. It comes back, from the source.
//   - A conflict is not a conflict here. The source wins and nothing is kept
//     beside it, because keeping the destination's version would put a file on
//     the source side that its owner never made.
//   - A rename ON the source is the same case as a copy towards it: the
//     destination moved something, so the source's own naming is restored.
//   - A file the source has never had is left exactly where it is. That is the
//     one thing a one-way job deliberately does not do, and it is the
//     difference between copying and mirroring: deleting something the source
//     never knew about is not propagating a decision, it is making one.
func Enforce(p *Plan, dir Direction) {
	if dir == Both {
		return
	}
	src := dir.source()
	dst := src.Other()

	kept := p.Actions[:0]
	for _, a := range p.Actions {
		switch a.Kind {
		case Copy:
			if a.Src == src {
				kept = append(kept, a)
				continue
			}
			// A change on the far side. Put the source's version back.
			if rebuilt, ok := restore(a, src, dst); ok {
				kept = append(kept, rebuilt)
			}
		case Conflict:
			if rebuilt, ok := restore(a, src, dst); ok {
				kept = append(kept, rebuilt)
			}
		case Delete:
			if a.Dst == dst {
				kept = append(kept, a)
				continue
			}
			// The destination removed something the source still holds.
			if rebuilt, ok := restore(a, src, dst); ok {
				kept = append(kept, rebuilt)
			}
		case Move:
			if a.Dst == dst {
				kept = append(kept, a)
			}
			// A move on the source side is dropped rather than rewritten: the
			// copy the same run already proposes puts the source's own naming
			// back, and the file under the destination's old name is left for
			// the person who renamed it.
		}
	}
	p.Actions = kept

	dirs := p.Dirs[:0]
	for _, d := range p.Dirs {
		// A record refresh writes to neither side and always survives.
		if d.Kind == RecordDir || d.Dst == dst {
			dirs = append(dirs, d)
		}
	}
	p.Dirs = dirs
}

// restore rebuilds an action as a copy from the source side, or reports that
// there is nothing on the source side to copy.
func restore(a Action, src, dst Side) (Action, bool) {
	have := a.LeftNow
	if src == Right {
		have = a.RightNow
	}
	if have == nil {
		// The source does not hold this file either. Nothing to send, and
		// nothing may be deleted on the source, so there is nothing to do.
		return Action{}, false
	}
	a.Kind = Copy
	a.Src = src
	a.Dst = dst
	a.SrcPath = have.Path
	a.DstPath = have.Path
	a.OldDstPath = ""
	a.Resolve = KeepBoth
	a.Reason = because("oneWay", "side", src.String())
	return a, true
}
