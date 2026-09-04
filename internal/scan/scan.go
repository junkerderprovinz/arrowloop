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
	"strings"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"
	"github.com/rclone/rclone/fs/walk"
)

// Entry is one file as it exists right now on one side.
type Entry struct {
	Path string
	Size int64
	Mod  time.Time

	obj     fs.Object
	hashed  bool
	hashsum string
}

// Object exposes the underlying rclone object so the apply stage can copy,
// move or delete it without listing the side a second time.
func (e *Entry) Object() fs.Object { return e.obj }

// Side is a listing of one side, keyed by relative path with forward slashes.
type Side map[string]*Entry

// reserved names this tool keeps for itself inside a synced tree. They are
// skipped on both sides, otherwise the trash would be synced into the other
// side's trash, forever.
const (
	MetaDir  = ".reeveroll"
	TrashDir = MetaDir + "/trash"
)

// IsReserved reports whether a relative path belongs to the tool rather than
// to the user's data.
func IsReserved(rel string) bool {
	return rel == MetaDir || strings.HasPrefix(rel, MetaDir+"/")
}

// List walks one side and returns every file in it.
//
// Hashes are deliberately NOT computed here. On a large tree hashing every
// file on every run costs more than the sync itself, and most files are
// settled by size and modification time alone. The hash is fetched lazily by
// Hash below, only for the files where it actually decides something.
func List(ctx context.Context, f fs.Fs) (Side, error) {
	out := make(Side)
	err := walk.ListR(ctx, f, "", true, -1, walk.ListObjects, func(entries fs.DirEntries) error {
		for _, entry := range entries {
			obj, ok := entry.(fs.Object)
			if !ok {
				continue
			}
			rel := path.Clean(obj.Remote())
			if IsReserved(rel) {
				continue
			}
			out[rel] = &Entry{
				Path: rel,
				Size: obj.Size(),
				Mod:  obj.ModTime(ctx),
				obj:  obj,
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list %s: %w", f.Name(), err)
	}
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
