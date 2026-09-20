package plan

// Direction is which way a job is allowed to write.
//
// Both sides are always compared. A one-way direction makes one side the
// source, which is never written to, and rewrites every action to run the
// other way or drops it. Filtering instead would report the far side's edits
// again on every run without ever converging.
type Direction int

const (
	// Both writes both ways; a conflict keeps both versions.
	Both Direction = iota
	// LeftToRight writes only to the right side.
	LeftToRight
	// RightToLeft writes only to the left side.
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

// ParseDirection reads what a person picked. Anything unrecognised is both
// ways, so an older engine never guesses at a side to overwrite.
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

// Enforce rewrites a plan so that it only writes to one side, treating the
// source as right:
//
//   - A copy towards the source means the destination changed; the source's
//     version is copied back over it.
//   - A delete on the source means the destination deleted something; it is
//     restored from the source.
//   - A conflict is won by the source, with nothing kept beside it.
//   - A rename on the source is dropped; the copy the same plan proposes
//     restores the source's naming.
//   - A file the source has never had stays, unless the mode is ModeMirror.
func Enforce(p *Plan, dir Direction, mode Mode) {
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
				if mode == ModeMove {
					a.Kind = Relocate
				}
				kept = append(kept, a)
				continue
			}
			if rebuilt, ok := restore(a, src, dst); ok {
				kept = append(kept, rebuilt)
				continue
			}
			// A file the source has never had.
			if mode == ModeMirror {
				if gone, ok := sweep(a, dst); ok {
					kept = append(kept, gone)
				}
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
			if rebuilt, ok := restore(a, src, dst); ok {
				kept = append(kept, rebuilt)
			}
		case Move:
			if a.Dst == dst {
				kept = append(kept, a)
				continue
			}
			// Under its new name on the destination, the file is one the
			// source has never had.
			if mode == ModeMirror {
				if gone, ok := sweep(a, dst); ok {
					kept = append(kept, gone)
				}
			}
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

// sweep rebuilds an action as a deletion on the destination side, for a file
// the source does not hold in ModeMirror. As an ordinary Delete it goes
// through the trash and the mass-delete brake like any other.
func sweep(a Action, dst Side) (Action, bool) {
	live := a.LeftNow
	if dst == Right {
		live = a.RightNow
	}
	if live == nil {
		return Action{}, false
	}
	a.Kind = Delete
	a.Src = dst.Other()
	a.Dst = dst
	a.SrcPath = ""
	a.DstPath = live.Path
	a.OldDstPath = ""
	a.Resolve = KeepBoth
	a.Reason = because("mirror", "side", dst.Other().String())
	return a, true
}

// restore rebuilds an action as a copy from the source side, or reports that
// there is nothing on the source side to copy.
func restore(a Action, src, dst Side) (Action, bool) {
	have := a.LeftNow
	if src == Right {
		have = a.RightNow
	}
	if have == nil {
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
