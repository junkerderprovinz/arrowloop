// Package trash reads and writes the reserved directory this tool keeps inside
// every synced tree.
//
// Two things are filed there and both were, until now, reachable only with a
// file manager. A deletion is a move into .arrowloop/trash/<run>/, which is what
// makes the promise at the top of internal/apply hold: nothing this program does
// destroys anything outright. And a file that is about to be overwritten can be
// set aside first into .arrowloop/versions/, which is the same promise extended
// to the one case the trash never covered, a file that is simply edited over and
// over.
//
// Everything here goes through rclone rather than through os and path/filepath,
// for the reason internal/scan gives: a side is a local folder, an SMB share, an
// SFTP host or an S3 bucket, and code that reaches for the local filesystem works
// on exactly one of those. The one place path/filepath would be tempting is the
// safety check on a caller's path, and it is precisely the place it must not be
// used: filepath answers differently on each platform, and a check that agrees
// with the host is a check that disagrees with the backend.
package trash

import (
	"context"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/operations"
	"github.com/rclone/rclone/fs/walk"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// RunIDLayout is how internal/apply stamps a run, and parsing it back is where
// the age of a deleted file honestly comes from.
//
// The trash is filed by run identifier and a directory carries no time of its
// own that means anything here. The object's own modification time is not the
// answer either, and believing it would be the worst kind of bug: rclone's local
// backend moves a file into the trash with os.Rename, which preserves the
// modification time, so a document last edited in 2019 and deleted this morning
// reads as six years old. Pruning on that would empty this morning's trash the
// first time anybody asked to clear out last year's.
//
// So the deletion time comes from the run identifier and from nowhere else, and
// an entry whose identifier does not parse has no known deletion time at all.
// Such an entry is listed, so nothing is hidden, and it is never pruned by age,
// because the alternative to knowing is guessing and a guess here deletes files.
const RunIDLayout = "20060102-150405"

// VersionsDir is where a file that was about to be overwritten is kept.
//
// Under the same reserved prefix as the trash, and that is the whole mechanism:
// internal/scan skips everything under .arrowloop on both sides, so a kept
// version never travels anywhere and never comes back as a file somebody
// created. Putting versions outside the tree instead would be cleaner in
// principle and unusable in practice, because on an S3 bucket or an SFTP export
// there is often no outside.
const VersionsDir = scan.MetaDir + "/versions"

// legacyTrashDir is the trash an older build of this tool wrote, before it was
// renamed. It is listed and it can be restored from and pruned, because the
// files in it are somebody's deleted files whatever the folder above them is
// called, and internal/scan already keeps the whole prefix reserved for good.
const legacyTrashDir = ".reeveroll/trash"

// layout says how a store spells the two things it has to record, the run and
// the path the file had.
type layout int

const (
	// runFirst is <dir>/<run>/<path>, which is what a deletion writes. It groups
	// a whole run together, so emptying everything older than a date is the
	// removal of a few directories rather than a decision per file.
	runFirst layout = iota
	// pathFirst is <dir>/<path>/<run><ext>, which is what a kept version writes.
	// It groups a file's history together, so pruning to the last N is one
	// listing of one directory rather than a walk of everything ever kept.
	pathFirst
)

// Store is one of the reserved directories, named rather than pathed.
//
// A caller sends the NAME of a store and never a directory, which is the same
// shape internal/web/state.go uses for a job: a caller that cannot say a path
// cannot say a path outside the tree. The set is closed and known at compile
// time, so there is no arithmetic between what arrives and what is opened.
type Store struct {
	name   string
	dir    string
	layout layout
}

var (
	// Trash is where deletions go.
	Trash = Store{name: "trash", dir: scan.TrashDir, layout: runFirst}
	// LegacyTrash is where deletions went before the tool was renamed.
	LegacyTrash = Store{name: "legacyTrash", dir: legacyTrashDir, layout: runFirst}
	// Versions is where a file that was about to be overwritten is kept.
	Versions = Store{name: "versions", dir: VersionsDir, layout: pathFirst}
)

// Name is what a caller sends to ask for this store.
func (s Store) Name() string { return s.name }

// Dir is where this store lives inside a side, relative to that side's root.
func (s Store) Dir() string { return s.dir }

// StoreNamed looks a store up by the name a caller sent.
func StoreNamed(name string) (Store, bool) {
	for _, s := range []Store{Trash, LegacyTrash, Versions} {
		if s.name == name {
			return s, true
		}
	}
	return Store{}, false
}

// Entry is one thing kept in a reserved directory.
type Entry struct {
	// Path is where the file was in the synced tree, which is where a restore
	// puts it back.
	Path string
	// RunID is the run that filed it. Empty when the entry does not fit the
	// store's layout at all, which means somebody put a file there by hand:
	// nothing this program writes can produce one.
	RunID string
	// Remote is where the file is now, relative to the side's root. Reported so
	// that a person who would rather use a file manager can find it, and so that
	// a listing never has to be trusted to be reversible.
	Remote string
	Size   int64

	// Filed is when the run happened, parsed from RunID. Zero when RunID is
	// empty or does not parse, and a zero here means unknown rather than 1970:
	// see RunIDLayout for why nothing else is allowed to stand in for it.
	Filed time.Time

	// Modified is the file's own modification time, which survives the move into
	// the reserved directory. It is what the file says about itself and it is
	// NOT when the file was deleted, so it is reported beside Filed rather than
	// instead of it.
	Modified time.Time
}

// Known says whether this entry's own time is known, which is the question
// pruning by age has to ask before it touches anything.
func (e Entry) Known() bool { return !e.Filed.IsZero() }

// List reads everything one store holds on one side.
//
// The whole store, with no paging. That is a real cost on a trash nobody has
// emptied for a year, and it is the honest shape for what this answers: the
// question is "what is in here", the backend has to be walked to answer it, and
// a first page would cost the same walk. A caller that has to show a screen
// should cap what it renders rather than ask for a cheaper truth.
//
// A store that is not there is empty rather than broken. A job whose trash has
// never been written is the ordinary case, and on a bucket backend the directory
// does not exist as a thing at all.
func List(ctx context.Context, f fs.Fs, store Store) ([]Entry, error) {
	var out []Entry
	err := walk.ListR(ctx, f, store.dir, true, -1, walk.ListObjects, func(entries fs.DirEntries) error {
		for _, entry := range entries {
			obj, ok := entry.(fs.Object)
			if !ok {
				continue
			}
			out = append(out, store.entryOf(ctx, obj))
		}
		return nil
	})
	if err != nil && !errors.Is(err, fs.ErrorDirNotFound) {
		return nil, fmt.Errorf("read the %s of %s: %w", store.name, f.Name(), err)
	}

	// Newest first, and by run rather than by modification time, because the
	// question somebody has in front of this list is almost always "what did the
	// last run take away". Entries with no known time sort last: they are the
	// odd ones out, and burying the ordinary answer under them would be a poor
	// trade for the rare case.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].RunID != out[j].RunID {
			return out[i].RunID > out[j].RunID
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}

// entryOf reads one object back into the two facts the store encoded into its
// name, the run and the original path.
//
// An object that does not fit the layout is reported rather than dropped. It
// cannot have been written by this program, so somebody put it there, and a
// listing that quietly omitted it would be a listing that tells its reader the
// folder is empty while their file manager shows a file in it. It comes back
// with no run identifier, which is what makes it unrestorable through here and
// invisible to pruning by age.
func (s Store) entryOf(ctx context.Context, obj fs.Object) Entry {
	remote := obj.Remote()
	e := Entry{Remote: remote, Size: obj.Size(), Modified: obj.ModTime(ctx)}

	rel := strings.TrimPrefix(remote, s.dir+"/")
	switch s.layout {
	case runFirst:
		run, kept, found := strings.Cut(rel, "/")
		if !found {
			e.Path = rel
			return e
		}
		e.RunID, e.Path = run, kept
	case pathFirst:
		at := strings.LastIndex(rel, "/")
		if at < 0 {
			e.Path = rel
			return e
		}
		name := rel[at+1:]
		e.RunID, e.Path = strings.TrimSuffix(name, path.Ext(name)), rel[:at]
	}
	if when, err := time.Parse(RunIDLayout, e.RunID); err == nil {
		e.Filed = when
	}
	return e
}

// remote builds where an entry sits from the two things a caller sent, and
// refuses anything that is not exactly those two things.
//
// Built here rather than taken from a listing, and that is the point. A listing
// is a convenience for a screen; the value that comes back over the wire is
// whatever the caller chose to send, and treating a returned remote as
// trustworthy because this program once produced one is how a check gets skipped.
func (s Store) remote(rel, runID string) (string, error) {
	rel, err := CheckRel(rel)
	if err != nil {
		return "", err
	}
	if err := checkSegment(runID); err != nil {
		return "", err
	}
	return s.at(rel, runID)
}

// at builds where an entry sits from a path this program produced rather than
// one somebody sent.
//
// Separate from remote() because the strict check remote() applies is a check on
// a WIRE value and would be wrong here. A backend's own spelling of a file may
// legally contain a backslash, on S3 and on SFTP both, and refusing it would mean
// this program declines to keep a version of a file it is perfectly happy to
// sync. The confinement check still applies, because that one is about where the
// result lands and is true of every caller.
func (s Store) at(rel, runID string) (string, error) {
	if s.layout == pathFirst {
		return under(s.dir, rel, runID+path.Ext(rel))
	}
	return under(s.dir, runID, rel)
}

// liveDest proves a path a caller sent is somewhere a restore may actually put
// a file.
//
// It is CheckRel plus one more refusal, and the extra one is about the reserved
// directory. Nothing under .arrowloop is ever listed by internal/scan, so no file
// there was ever planned for deletion and no trash entry can honestly claim to
// have come from there. A caller naming such a path is confused or probing, and
// either way a restore into the reserved directory would put a file exactly where
// the engine promises not to look at one, which is how a stray copy lives
// forever without anybody being told.
func liveDest(rel string) (string, error) {
	dest, err := CheckRel(rel)
	if err != nil {
		return "", err
	}
	if scan.IsReserved(dest) {
		return "", fmt.Errorf("%w: %q is inside the directory this tool keeps for itself", ErrNotAName, dest)
	}
	return dest, nil
}

// ExistsError says a restore was refused because something is already at the
// name it would have landed on.
//
// Its own type because this is the one refusal a caller has to be able to
// recognise and offer a way past: everything else here is a bad request, and
// this is a correct request that would destroy something.
type ExistsError struct {
	Path string
}

func (e *ExistsError) Error() string {
	return fmt.Sprintf("%q is there right now, and putting the old version back would replace it with nothing behind it", e.Path)
}

// Restore puts one entry back where it came from.
//
// The refusal to overwrite is the whole of this function and everything else is
// arrangement around it. Every other way this program removes a file leaves a
// copy somewhere: a deletion goes to the trash, a losing conflict goes to the
// trash or is kept beside the winner, an overwrite can be kept as a version.
// A restore that replaced whatever is at the path now would be the single
// operation in the program with nothing behind it, and the file it destroyed
// would be the NEWER of the two.
//
// The check is a check and not a lock, which has to be said plainly. Between
// asking whether the name is free and moving onto it there is a window in which
// something else can create it, and there is no create-if-absent move that S3,
// SFTP and a local disk all offer, so there is nothing here that would close it.
// The window is the width of one metadata call, the other writer would have to
// be the sync engine or a person, and a job that is running is exactly when
// nobody should be restoring. It is a real gap and it is the smallest available
// one, not an oversight.
func Restore(ctx context.Context, f fs.Fs, store Store, rel, runID string) error {
	dest, err := liveDest(rel)
	if err != nil {
		return err
	}
	src, err := store.remote(rel, runID)
	if err != nil {
		return err
	}

	switch _, err := f.NewObject(ctx, dest); {
	case err == nil:
		return &ExistsError{Path: dest}
	case errors.Is(err, fs.ErrorIsDir):
		// A directory wearing the name is still something in the way, and
		// letting the move decide would turn a clear refusal into whatever the
		// backend makes of a file landing on a folder.
		return &ExistsError{Path: dest}
	case errors.Is(err, fs.ErrorObjectNotFound):
		// The name is free, which is the only case that carries on.
	default:
		// Anything else means the side could not be asked, and a restore that
		// treated "I could not look" as "nothing is there" would overwrite on
		// exactly the runs where the backend was having a bad day.
		return fmt.Errorf("could not check whether %q is free: %w", dest, err)
	}

	return operations.MoveFile(ctx, f, f, dest, src)
}
