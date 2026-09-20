// Package trash reads and writes the reserved directory this tool keeps inside
// every synced tree.
//
// A deletion is a move into .arrowloop/trash/<run>/, and a file about to be
// overwritten can be set aside into .arrowloop/versions/. Everything goes
// through rclone, since a side can be a local folder, an SMB share, an SFTP
// host or an S3 bucket. Path checks use package path rather than
// path/filepath, whose answer depends on the host rather than the backend.
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

// RunIDLayout is how internal/apply stamps a run. The run identifier is the
// only source of an entry's deletion time: the local backend moves a file into
// the trash with os.Rename, which keeps its modification time, so a file
// edited years ago and deleted today would look years old. An entry whose
// identifier does not parse is listed but never pruned by age.
const RunIDLayout = "20060102-150405"

// VersionsDir is where a file that was about to be overwritten is kept. It is
// under the reserved prefix that internal/scan skips on both sides, so a kept
// version never syncs; on a bucket or an SFTP export there is often no place
// outside the tree.
const VersionsDir = scan.MetaDir + "/versions"

// legacyTrashDir is the trash written by older builds. It can still be listed,
// restored from and pruned.
const legacyTrashDir = ".reeveroll/trash"

// layout says how a store arranges the run and the original path.
type layout int

const (
	// runFirst is <dir>/<run>/<path>, written by a deletion, so pruning by date
	// removes whole run directories.
	runFirst layout = iota
	// pathFirst is <dir>/<path>/<run><ext>, written by a kept version, so
	// keeping the last N is one listing of one directory.
	pathFirst
)

// Store is one of the reserved directories. Callers name a store rather than
// send a directory, so they cannot address a path outside the tree.
type Store struct {
	name   string
	dir    string
	layout layout
}

var (
	// Trash is where deletions go.
	Trash = Store{name: "trash", dir: scan.TrashDir, layout: runFirst}
	// LegacyTrash is where older builds put deletions.
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
	// RunID is the run that filed it. It is empty when the entry does not fit
	// the store's layout, which means somebody put the file there by hand.
	RunID string
	// Remote is where the file is now, relative to the side's root, for anyone
	// who would rather use a file manager.
	Remote string
	Size   int64

	// Filed is when the run happened, parsed from RunID. Zero means unknown.
	Filed time.Time

	// Modified is the file's own modification time, which survives the move
	// and is not when the file was deleted.
	Modified time.Time
}

// Known reports whether the entry's deletion time is known.
func (e Entry) Known() bool { return !e.Filed.IsZero() }

// List reads everything one store holds on one side, newest run first. A store
// that does not exist is empty.
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

	// Entries without a run identifier sort last.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].RunID != out[j].RunID {
			return out[i].RunID > out[j].RunID
		}
		return out[i].Path < out[j].Path
	})
	return out, nil
}

// entryOf reads the run and the original path back from an object's name. An
// object that does not fit the layout is still listed, with no run identifier,
// which keeps it out of restores and pruning by age.
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

// remote builds where an entry sits from a path and run identifier a caller
// sent, refusing anything else. It never trusts a remote taken from a listing.
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

// at builds where an entry sits from a path this program produced. It skips
// the checks for wire values, because a backend's own name may contain a
// backslash on S3 or SFTP, but still confines the result to the store.
func (s Store) at(rel, runID string) (string, error) {
	if s.layout == pathFirst {
		return under(s.dir, rel, runID+path.Ext(rel))
	}
	return under(s.dir, runID, rel)
}

// liveDest checks that a path a caller sent is somewhere a restore may put a
// file: CheckRel, plus a refusal of the reserved directory, which the engine
// never lists and so no entry can have come from.
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
// name it would have landed on. Unlike the other refusals it answers a valid
// request, so callers can offer a way past it.
type ExistsError struct {
	Path string
}

func (e *ExistsError) Error() string {
	return fmt.Sprintf("%q is there right now, and putting the old version back would replace it with nothing behind it", e.Path)
}

// Restore puts one entry back where it came from. It never overwrites: every
// other way this program removes a file leaves a copy behind, and a restore
// over the live file would destroy the newer one.
//
// The check is not a lock. No create-if-absent move exists on every backend,
// so something could appear at the name between the check and the move.
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
		return &ExistsError{Path: dest}
	case errors.Is(err, fs.ErrorObjectNotFound):
	default:
		// Not being able to look is not the same as nothing being there.
		return fmt.Errorf("could not check whether %q is free: %w", dest, err)
	}

	return operations.MoveFile(ctx, f, f, dest, src)
}
