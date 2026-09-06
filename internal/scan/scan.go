// Package scan lists one side of a sync job through rclone.
//
// Everything below goes through rclone's Fs interface rather than the local
// filesystem, so a side is a local folder, an SMB share, an SFTP host or an S3
// bucket without a single branch in the calling code. That is the whole reason
// rclone is embedded instead of reimplemented.
package scan

import (
	"context"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/walk"

	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/pathid"
)

// Entry is one file as it exists right now on one side.
//
// Path is what the backend actually calls it, byte for byte, and it is what
// gets handed back to the backend for any operation. Key is what the file is
// matched by, which can differ: a name stored decomposed on macOS and composed
// on Windows is one file with two spellings.
type Entry struct {
	Path string
	Key  string
	Size int64
	Mod  time.Time

	obj     fs.Object
	hashed  bool
	hashsum string
}

// Object exposes the underlying rclone object so the apply stage can copy,
// move or delete it without listing the side a second time.
func (e *Entry) Object() fs.Object { return e.obj }

// Side is a listing of one side, keyed by matching key.
type Side map[string]*Entry

// Collision is two files on ONE side whose names differ only in ways the other
// side cannot represent, almost always just letter case.
//
// This has to be reported rather than resolved. Copying both onto a
// case-insensitive destination means the second silently overwrites the first,
// and the engine would then record that overwrite as a successful sync.
type Collision struct {
	Key   string
	Paths []string
}

// Listing is what one side looks like plus anything wrong with it.
type Listing struct {
	Files Side
	// Dirs maps a matching key to the directory's real name on this side. It
	// is only filled when Options.Dirs is set, because most jobs do not need
	// it: a directory holding files is implied by the files, and listing
	// directories costs a second pass on backends that cannot return both at
	// once. Empty directories are the reason it exists at all.
	Dirs       map[string]string
	Collisions []Collision
	Excluded   int
}

// Options controls how a side is read.
type Options struct {
	// FoldCase must be true when EITHER side is case-insensitive. It is a
	// property of the job, not of one side: folding on one end only makes two
	// files over there map onto one file over here, and the engine then
	// oscillates between them.
	FoldCase bool

	// Exclude hides paths from the job entirely. The same set has to be applied
	// to the stored record as well, or newly excluded files read as deletions.
	Exclude *filter.Set

	// Dirs asks for directories as well as files. Only worth setting when both
	// sides can actually hold an empty directory: a bucket backend such as S3
	// has no directories at all, only key prefixes, so there is nothing there
	// to create or remove.
	Dirs bool
}

// reserved names this tool keeps for itself inside a synced tree. They are
// skipped on both sides, otherwise the trash would be synced into the other
// side's trash, forever.
const (
	MetaDir  = ".arrowloop"
	TrashDir = MetaDir + "/trash"

	// legacyMetaDir is what this directory was called before the tool was
	// renamed. It stays reserved for good, and the reason is not tidiness: a
	// tree that an older build already synced still holds one, it has no row in
	// the state database because it was skipped back then, so the moment it
	// counts as ordinary data it looks like a folder somebody just created. The
	// engine would then copy a trash folder full of deleted files onto the other
	// side, where it lands inside that side's own reserved directory rules and
	// stays for ever. Two string comparisons are a cheap price for never doing
	// that to anybody.
	legacyMetaDir = ".reeveroll"
)

// IsReserved reports whether a relative path belongs to the tool rather than
// to the user's data.
func IsReserved(rel string) bool {
	for _, dir := range [...]string{MetaDir, legacyMetaDir} {
		if rel == dir || strings.HasPrefix(rel, dir+"/") {
			return true
		}
	}
	return false
}

// List walks one side and returns every file in it.
//
// Hashes are deliberately NOT computed here. On a large tree hashing every
// file on every run costs more than the sync itself, and most files are
// settled by size and modification time alone. The hash is fetched lazily by
// Hash below, only for the files where it actually decides something.
func List(ctx context.Context, f fs.Fs, opt Options) (*Listing, error) {
	out := &Listing{Files: make(Side)}
	clashes := map[string][]string{}
	listType := walk.ListObjects
	if opt.Dirs {
		out.Dirs = map[string]string{}
		listType = walk.ListAll
	}

	err := walk.ListR(ctx, f, "", true, -1, listType, func(entries fs.DirEntries) error {
		for _, entry := range entries {
			if dir, isDir := entry.(fs.Directory); isDir {
				if !opt.Dirs {
					continue
				}
				rel := path.Clean(dir.Remote())
				if IsReserved(rel) || opt.Exclude.Excluded(rel) {
					continue
				}
				out.Dirs[pathid.Key(rel, opt.FoldCase)] = rel
				continue
			}
			obj, ok := entry.(fs.Object)
			if !ok {
				continue
			}
			rel := path.Clean(obj.Remote())
			if IsReserved(rel) {
				continue
			}
			if opt.Exclude.Excluded(rel) {
				out.Excluded++
				continue
			}
			key := pathid.Key(rel, opt.FoldCase)
			if first, seen := out.Files[key]; seen {
				clashes[key] = append(clashes[key], first.Path, rel)
				continue
			}
			out.Files[key] = &Entry{Path: rel, Key: key, Size: obj.Size(), Mod: obj.ModTime(ctx), obj: obj}
		}
		return nil
	})
	if err != nil {
		// A side that does not exist yet is empty, not broken. On a bucket
		// backend the destination of a brand new job is a bucket nobody has
		// created, and on SFTP it is a directory nobody has made; both answer a
		// listing with "not found". Treating that as a failure would mean no
		// job could ever run for the first time against a fresh target, which
		// is precisely the moment somebody is setting one up.
		//
		// This does not weaken the refusal to believe an empty side. That guard
		// compares against the RECORD: a side that used to hold files and now
		// reports nothing is still refused, whether it reported nothing by
		// listing zero objects or by not being there at all.
		if !errors.Is(err, fs.ErrorDirNotFound) {
			return nil, fmt.Errorf("list %s: %w", f.Name(), err)
		}
	}

	for key, paths := range clashes {
		// The first path was already in the map, so it appears twice in the
		// slice the first time a clash is seen. Collapse it.
		seen := map[string]bool{}
		var uniq []string
		for _, p := range paths {
			if !seen[p] {
				seen[p] = true
				uniq = append(uniq, p)
			}
		}
		sort.Strings(uniq)
		out.Collisions = append(out.Collisions, Collision{Key: key, Paths: uniq})
		// A colliding key is removed from the listing entirely. Leaving one of
		// the two in would sync an arbitrary winner and quietly drop the other.
		delete(out.Files, key)
	}
	sort.Slice(out.Collisions, func(i, j int) bool { return out.Collisions[i].Key < out.Collisions[j].Key })
	return out, nil
}

// Hash returns the file's MD5, or an empty string when the backend cannot
// produce one.
//
// An empty result means "unknown", never "no content". Callers must fall back
// to size and modification time in that case instead of treating two unknown
// hashes as equal, otherwise two different files of the same size on a
// hashless backend would silently be considered identical.
func (e *Entry) Hash(ctx context.Context) string {
	if e.hashed {
		return e.hashsum
	}
	e.hashed = true
	if e.obj == nil {
		return ""
	}
	sum, err := e.obj.Hash(ctx, hash.MD5)
	if err != nil {
		if !errors.Is(err, hash.ErrUnsupported) {
			fs.Debugf(e.obj, "hash failed, falling back to size and time: %v", err)
		}
		return ""
	}
	e.hashsum = sum
	return sum
}
