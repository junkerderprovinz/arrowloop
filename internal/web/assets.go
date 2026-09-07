package web

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"sync"
)

// The cache story for the embedded interface, and why it needs one at all.
//
// An embedded file has no modification time, so net/http sends no
// Last-Modified, and nothing here was sending an ETag either. That leaves the
// browser with NO validator whatsoever: it may hold the bundle it already has
// for as long as it likes, and a reload is entitled to answer out of its own
// cache without asking. The symptom is not an error. It is a person looking at
// a new build and seeing the old interface, reporting "das UI ist völlig
// unverändert", while every check from the outside says the server is fine,
// because the server IS fine and the stale copy is in one browser.
//
// Two headers fix it, and they pull in opposite directions on purpose:
//
//   - index.html gets `no-cache`, which does not mean "do not store" but "ask
//     before using". Every load costs one conditional request that almost
//     always comes back 304 and empty. That is the file that must never be
//     stale, because it names the others.
//   - Everything under /assets/ is content-hashed by the build, so the name
//     changes whenever the bytes do. Those get a year and `immutable`: the
//     browser may use them without asking, and it can never be wrong, because
//     a changed file arrives under a different name.
//
// The ETag is a SHA-256 over the bytes, computed once at startup and kept. It
// is the only validator available for a file that has no clock behind it.

type assetInfo struct {
	etag string
}

// assets remembers one fingerprint per embedded file.
//
// Built lazily and once, because a binary with no interface embedded should not
// walk a filesystem that is not there, and because the answer never changes for
// the lifetime of the process: the files are inside the executable.
type assets struct {
	once   sync.Once
	byPath map[string]assetInfo
}

func (a *assets) info(fsys fs.FS, name string) (assetInfo, bool) {
	a.once.Do(func() {
		a.byPath = map[string]assetInfo{}
		if fsys == nil {
			return
		}
		_ = fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			f, oErr := fsys.Open(p)
			if oErr != nil {
				return nil
			}
			defer f.Close()
			sum := sha256.New()
			if _, cErr := io.Copy(sum, f); cErr != nil {
				return nil
			}
			// Quoted and weak-free: a strong validator, which is what allows a
			// range request to be answered from the same copy.
			a.byPath[p] = assetInfo{etag: `"` + hex.EncodeToString(sum.Sum(nil)[:16]) + `"`}
			return nil
		})
	})
	got, ok := a.byPath[name]
	return got, ok
}

// setCacheHeaders decides how long a browser may keep one file without asking.
func setCacheHeaders(w http.ResponseWriter, name string, info assetInfo, found bool) {
	if found {
		w.Header().Set("ETag", info.etag)
	}
	if isFingerprinted(name) {
		// The name carries the content hash, so a different build is a
		// different URL and this copy can never become wrong.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	// Everything else, index.html above all: store it, but ask before using it.
	w.Header().Set("Cache-Control", "no-cache")
}

// isFingerprinted reports whether the build gave this file a content-hashed
// name. Vite puts them all under assets/ with the hash in the stem, and that
// directory is the contract rather than a guess about the shape of the hash.
func isFingerprinted(name string) bool {
	return strings.HasPrefix(name, "assets/")
}
