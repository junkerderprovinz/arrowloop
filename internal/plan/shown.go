package plan

// Shown is an action as a preview puts it in front of somebody: what it does
// and between which ends. A run of the rows somebody ticked compares the fresh
// plan with it, since a file can change between the preview and the run.
type Shown struct {
	Kind string `json:"kind"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

// Show describes the action the way a preview lists it: the sides for a copy,
// a relocation and a deletion, the old and new name for a move.
func (a Action) Show() Shown {
	s := Shown{Kind: a.Kind.String()}
	switch a.Kind {
	case Copy, Relocate:
		s.From, s.To = a.Src.String(), a.Dst.String()
	case Move:
		s.From, s.To = a.OldDstPath, a.DstPath
	case Delete:
		s.To = a.Dst.String()
	}
	return s
}

// Show describes the directory action the way a preview lists it.
func (d DirAction) Show() Shown {
	return Shown{Kind: d.Kind.String(), To: d.Dst.String()}
}
