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

// An embedded file has no modification time, so without an ETag the browser
// has no validator and may keep showing an old build. index.html gets no-cache
// (store, but ask first), because it names the other files; everything under
// assets/ is content-hashed by the build and may be kept for a year.

type assetInfo struct {
	etag string
}

// assets remembers a SHA-256 fingerprint per embedded file, computed lazily
// and once, since the files are inside the executable.
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
			// A strong validator, which lets a range request be answered from
			// the same copy.
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
		// A different build means a different name.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
}

// isFingerprinted reports whether the build gave this file a content-hashed
// name, which Vite does for everything under assets/.
func isFingerprinted(name string) bool {
	return strings.HasPrefix(name, "assets/")
}
