package plan

// What a one-way job does with the things the direction alone does not settle.
//
// The direction says which way a job may WRITE. It leaves two questions open,
// and a tool people compare this one against answers both by shipping seven
// named modes: two-way, upload only, upload and then delete, mirror device to
// cloud, download only, download and then delete, mirror cloud to device.
//
// Those seven are two axes wearing seven names. The direction is one; this is
// the other, and keeping them apart is what stops the list growing to fifteen
// entries the day a third question turns up.
//
//	              sync            mirror              move
//	both ways     two-way         -                   -
//	to the right  upload only     device to cloud     upload, then delete
//	to the left   download only   cloud to device     download, then delete
//
// The two blanks are not missing work. Mirroring both ways is a contradiction -
// each side would have to be the authority on what the other may keep - and
// moving both ways is a job that empties both sides into each other.
type Mode int

const (
	// ModeSync copies and leaves everything else alone. A file the source never
	// had stays where it is, which is the difference between copying and
	// mirroring: deleting something the source never knew about is not
	// passing a decision on, it is making one.
	ModeSync Mode = iota

	// ModeMirror makes the destination an exact copy of the source, so a file the
	// source never had is deleted there.
	//
	// The bins and the mass-deletion brake still apply, and that is what makes
	// this mode offerable at all: a mirror that got its two sides the wrong way
	// round would otherwise empty somebody's photo library in one run with no
	// way back.
	ModeMirror

	// ModeMove copies and then removes the file from the SOURCE, which is the
	// commonest thing anybody wants from a phone: everything the camera made
	// goes up, and the space comes back.
	//
	// It is one action rather than a copy followed by a delete, and that is a
	// safety property rather than tidiness: as two actions, a copy that failed
	// would leave the delete behind it in the queue.
	ModeMove
)

func (m Mode) String() string {
	switch m {
	case ModeMirror:
		return "mirror"
	case ModeMove:
		return "move"
	default:
		return "sync"
	}
}

// ParseMode reads what a person picked.
//
// Anything unrecognised is ModeSync, for the same reason an unrecognised direction
// is two ways: a newer interface asking an older engine for a mode it has never
// heard of must do the careful thing, not guess at something to delete.
func ParseMode(text string) Mode {
	switch text {
	case "mirror":
		return ModeMirror
	case "move":
		return ModeMove
	default:
		return ModeSync
	}
}
