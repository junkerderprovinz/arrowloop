package web

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"html"
	"io"
	"io/fs"
	"net/http"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
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

// basePrefix is the path the browser sees the interface under: the one a
// reverse proxy or the fortress names in X-Forwarded-Prefix, else the root.
// It lands in the page, so only a clean path counts.
func basePrefix(r *http.Request) string {
	p := r.Header.Get("X-Forwarded-Prefix")
	if !prefixPattern.MatchString(p) {
		return "/"
	}
	if !strings.HasSuffix(p, "/") {
		p += "/"
	}
	if p != "/" && path.Clean(p)+"/" != p {
		return "/"
	}
	return p
}

var (
	prefixPattern = regexp.MustCompile(`^/[A-Za-z0-9._~/-]{0,254}$`)
	basePattern   = regexp.MustCompile(`(?i)<base\s[^>]*>`)
	headPattern   = regexp.MustCompile(`(?i)<head(\s[^>]*)?>`)
)

// serveIndex answers index.html with a base element for the path it is
// served under, which every relative address in the interface goes by.
func serveIndex(w http.ResponseWriter, r *http.Request, index io.Reader) {
	raw, err := io.ReadAll(index)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	base := `<base href="` + html.EscapeString(basePrefix(r)) + `">`
	page := withBase(basePattern.ReplaceAllLiteral(raw, nil), base)
	sum := sha256.Sum256(page)
	h := w.Header()
	h.Set("ETag", `"`+hex.EncodeToString(sum[:16])+`"`)
	h.Set("Cache-Control", "no-cache")
	h.Add("Vary", "X-Forwarded-Prefix")
	h.Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(page))
}

// withBase puts base first in the page's head, or at its top where it has
// none.
func withBase(page []byte, base string) []byte {
	if at := headPattern.FindIndex(page); at != nil {
		return slices.Concat(page[:at[1]], []byte(base), page[at[1]:])
	}
	return slices.Concat([]byte(base), page)
}
