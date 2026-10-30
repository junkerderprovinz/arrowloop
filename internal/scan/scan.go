// Package scan lists one side of a sync job through rclone's Fs interface, so a
// side can be a local folder, an SMB share, an SFTP host or an S3 bucket
// without a branch in the calling code.
package scan

import (
	"context"
	"errors"
	"fmt"
	iofs "io/fs"
	"path"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rclone/rclone/backend/onedrive/api"
	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/accounting"
	"github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/rc"
	"github.com/rclone/rclone/fs/walk"

	"github.com/junkerderprovinz/arrowloop/internal/detach"
	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/pathid"
)

// Entry is one file as it exists right now on one side. Path is the backend's
// name for it, byte for byte, and is what operations use; Key is what it is
// matched by (see pathid.Key).
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

// Collision is two files on one side whose names differ only in ways the other
// side cannot represent, usually letter case. It is reported rather than
// resolved, because copying both to a case-insensitive side would silently
// overwrite one with the other.
type Collision struct {
	Key   string
	Paths []string
}

// Listing is what one side looks like plus anything wrong with it.
type Listing struct {
	Files Side
	// Dirs maps a matching key to the directory's real name on this side. It
	// is only filled when Options.Dirs is set; it exists for empty
	// directories, which the files do not imply.
	Dirs       map[string]string
	Collisions []Collision
	Excluded   int
	// Sealed lists the folders the backend shows but never lets an app open,
	// such as OneDrive's Personal Vault. What they hold is unknown, not
	// absent.
	Sealed []string
	// Unreadable lists the folders below the root that could not be read.
	// What they hold is unknown, not absent, so a run leaves each one alone
	// on both sides.
	Unreadable []Unreadable
}

// Unreadable is a folder below the root that could not be listed.
type Unreadable struct {
	Path string
	// Gone is true for a folder that disappeared between being seen in its
	// parent and being opened, as a temporary folder does, and false for one
	// the side refused to open.
	Gone bool
	Err  error
}

// Options controls how a side is read.
type Options struct {
	// FoldCase must be true when either side is case-insensitive (see
	// pathid.Key).
	FoldCase bool

	// Exclude hides paths from the job. The same set has to be applied to the
	// stored record, or newly excluded files read as deletions.
	Exclude *filter.Set

	// Dirs asks for directories as well as files. It only makes sense when
	// both sides can hold an empty directory, which bucket backends such as S3
	// cannot.
	Dirs bool
}

// Directories the tool keeps for itself inside a synced tree. They are skipped
// on both sides, or each side's trash would be synced into the other's.
const (
	MetaDir  = ".arrowloop"
	TrashDir = MetaDir + "/trash"

	// legacyMetaDir is the reserved directory of older builds. Trees they
	// synced still hold one, with no row in the state database, so without
	// the reservation its trash would be copied to the other side as new data.
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

// List walks one side and returns every file in it. Hashes are not computed
// here, since size and modification time settle most files; Hash fetches one
// only where it decides something.
func List(ctx context.Context, f fs.Fs, opt Options) (*Listing, error) {
	out := &Listing{Files: make(Side)}
	clashes := map[string][]string{}
	listType := walk.ListObjects
	if opt.Dirs {
		out.Dirs = map[string]string{}
		listType = walk.ListAll
	}

	found := 0
	Report(ctx, Reading{Stage: StageList})
	// The global group and a run's group also count what other work fails
	// meanwhile, so the walk counts its errors in a group of its own.
	group := fmt.Sprintf("scan/%d", scans.Add(1))
	defer dropStats(group)
	ctx = accounting.WithStatsGroup(ctx, group)
	stats := accounting.Stats(ctx)
	side := pruned{Fs: f, exclude: opt.Exclude, mu: &sync.Mutex{}, sealed: &out.Sealed, unreadable: &out.Unreadable}
	err := walk.ListR(ctx, side, "", true, -1, listType, func(entries fs.DirEntries) error {
		defer func() { Report(ctx, Reading{Stage: StageList, Done: found}) }()
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
			found++
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
		// A side that does not exist yet is empty: the target of a new job is
		// often a bucket or directory nobody has created. The guard against
		// an empty side compares with the record, so it still catches a side
		// that used to hold files. The walk reports a missing folder below
		// the root the same way, and that one is a failed listing whose files
		// would read as deleted.
		if !errors.Is(err, fs.ErrorDirNotFound) || exists(ctx, f) {
			return nil, fmt.Errorf("list %s: %w", f.Name(), err)
		}
		return out, nil
	}
	// Folders below the root are listed in groups of their own, so what
	// counts here is the root.
	if stats.GetErrors() > 0 {
		return nil, fmt.Errorf("list %s: a folder could not be read: %w", f.Name(), stats.GetLastError())
	}
	// A drive pulled out or a share dropped during the walk makes every
	// folder after it disappear, and a side that is gone is not one with a
	// few folders missing.
	if len(out.Unreadable) > 0 && !exists(ctx, f) {
		return nil, fmt.Errorf("list %s: the side went away while it was being read: %w", f.Name(), fs.ErrorDirNotFound)
	}

	for key, paths := range clashes {
		// The first path is appended again on every further clash.
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
		// Keeping one of them would sync an arbitrary winner.
		delete(out.Files, key)
	}
	sort.Slice(out.Collisions, func(i, j int) bool { return out.Collisions[i].Key < out.Collisions[j].Key })
	sort.Strings(out.Sealed)
	sort.Slice(out.Unreadable, func(i, j int) bool { return out.Unreadable[i].Path < out.Unreadable[j].Path })
	return out, nil
}

// scans numbers the stats groups of listings running at the same time.
var scans atomic.Int64

// dropStats removes a listing's stats group, which rclone offers only as a
// remote control call. rclone keeps at most max_stats_groups and drops the
// oldest first, which in a long-running daemon would be a job's own group in
// the middle of its run.
func dropStats(group string) {
	_, _ = rc.Calls.Get("core/stats-delete").Fn(context.Background(), rc.Params{"group": group})
}

// pruned lists a folder the job never looks into as empty, without opening it.
// The local backend opens every folder the walk reaches, and a drive root holds
// several, such as System Volume Information, that the process may not open;
// each would fail the scan. A sealed or unreadable folder is listed as empty
// too, and noted.
type pruned struct {
	fs.Fs
	exclude    *filter.Set
	mu         *sync.Mutex
	sealed     *[]string
	unreadable *[]Unreadable
}

func (p pruned) List(ctx context.Context, dir string) (fs.DirEntries, error) {
	if dir == "" {
		return p.Fs.List(ctx, dir)
	}
	if IsReserved(dir) || p.exclude.ExcludesTree(dir) {
		return nil, nil
	}
	entries, err := listCounted(ctx, p.Fs, dir)
	if err == nil {
		return entries, nil
	}
	gone := errors.Is(err, fs.ErrorDirNotFound)
	p.mu.Lock()
	defer p.mu.Unlock()
	switch {
	case isSealed(err):
		*p.sealed = append(*p.sealed, dir)
	case gone || errors.Is(err, iofs.ErrPermission):
		*p.unreadable = append(*p.unreadable, Unreadable{Path: dir, Gone: gone, Err: err})
	default:
		return nil, err
	}
	return nil, nil
}

// listCounted lists one folder and returns the error the backend counted
// rather than returned. The local backend lists a folder it may not open as
// empty and only counts the error, so a group per folder is what ties the
// error to the folder.
func listCounted(ctx context.Context, f fs.Fs, dir string) (fs.DirEntries, error) {
	group := fmt.Sprintf("scan/%d", scans.Add(1))
	defer dropStats(group)
	ctx = accounting.WithStatsGroup(ctx, group)
	entries, err := f.List(ctx, dir)
	if err != nil {
		return nil, err
	}
	if stats := accounting.StatsGroup(ctx, group); stats.GetErrors() > 0 {
		return nil, stats.GetLastError()
	}
	return entries, nil
}

// isSealed reports whether a folder failed to list because the backend keeps
// it from apps by design. OneDrive answers this way for the Personal Vault,
// whose name follows the account's language, so the error is the only
// reliable sign.
func isSealed(err error) bool {
	var od *api.Error
	return errors.As(err, &od) && od.ErrorInfo.InnerError.Code == "invalidResourceId"
}

// exists reports whether a side's root is there. Any answer other than "not
// found" counts as there, so a failing backend is not taken for an empty side.
func exists(ctx context.Context, f fs.Fs) bool {
	_, err := f.List(ctx, "")
	return !errors.Is(err, fs.ErrorDirNotFound)
}

// Hash returns the file's MD5, or an empty string when the backend cannot
// produce one. Callers must then fall back to size and modification time
// rather than treat two empty hashes as equal.
func (e *Entry) Hash(ctx context.Context) string {
	if e.hashed {
		return e.hashsum
	}
	// The local backend reads a file to its end for its checksum without
	// looking at the context, so a stopped run would read on.
	if ctx.Err() != nil {
		return ""
	}
	e.hashed = true
	if e.obj == nil {
		return ""
	}
	// An SFTP host reads the whole file in a command that does not stop with
	// the run, so a stop leaves it behind.
	sum, err := detach.Until(ctx, func() (string, error) { return e.obj.Hash(ctx, hash.MD5) })
	if err != nil {
		if !errors.Is(err, hash.ErrUnsupported) {
			fs.Debugf(e.obj, "hash failed, falling back to size and time: %v", err)
		}
		return ""
	}
	e.hashsum = sum
	return sum
}

// TimePrecision is how finely this side keeps modification times, reported
// only where a checksum means reading the whole file. There the time stands in
// for the checksum between two listings, so it is held to the backend's own
// rounding rather than to a window meant for two different backends.
func (e *Entry) TimePrecision() (time.Duration, bool) {
	if e.obj == nil {
		return 0, false
	}
	f := e.obj.Fs()
	if !f.Features().SlowHash || f.Precision() == fs.ModTimeNotSupported {
		return 0, false
	}
	return f.Precision(), true
}

// CheapHash is Hash where the backend keeps the checksum with the file, and an
// empty string where producing one means reading the whole file, as on a local
// disk or a mapped network drive.
func (e *Entry) CheapHash(ctx context.Context) string {
	if e.obj == nil || e.obj.Fs().Features().SlowHash {
		return ""
	}
	return e.Hash(ctx)
}
