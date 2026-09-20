package plan

// Mode is what a one-way job does beyond what its direction settles. Together
// with the direction it covers the usual named sync modes:
//
//	              sync            mirror              move
//	both ways     two-way
//	to the right  upload only     device to cloud     upload, then delete
//	to the left   download only   cloud to device     download, then delete
//
// Mirroring or moving both ways would have each side emptying the other.
type Mode int

const (
	// ModeSync copies and leaves everything else alone, including files the
	// source never had.
	ModeSync Mode = iota

	// ModeMirror makes the destination an exact copy of the source, so a file
	// the source never had is deleted there. The trash and the mass-delete
	// brake still apply, in case the two sides were set up the wrong way round.
	ModeMirror

	// ModeMove copies and then removes the file from the source, as one action
	// so a failed copy cannot leave a delete behind it.
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

// ParseMode reads what a person picked. Anything unrecognised is ModeSync, so
// an older engine never guesses at something to delete.
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
