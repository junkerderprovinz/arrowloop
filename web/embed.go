// Package webui carries the built interface into the binary.
//
// Go's //go:embed cannot reference a parent directory, so the directive has to
// live beside the files it embeds rather than beside the code that serves them.
// That is the only reason this package exists.
package webui

import (
	"embed"
	"io/fs"
)

// dist holds whatever the frontend build produced. On a fresh clone that is one
// empty keep-file and nothing else, which is what makes this compile before
// anybody has run the build.
//
//go:embed all:dist
var dist embed.FS

// Placeholder is the page a binary serves when it was built without the
// interface.
//
// It used to be a built index.html committed into dist, which looked like the
// same thing and was not: that file names two hashed asset files by their
// content, neither of which is committed, so a plain `go build` produced a
// binary whose interface was a blank page. A blank screen is indistinguishable
// from a broken one, and the documentation promised a page that says so.
//
//go:embed placeholder.html
var Placeholder []byte

// Files is the built interface, rooted at dist so that "index.html" means what
// it says. It is present and holds no index.html when the build was skipped.
func Files() (fs.FS, error) { return fs.Sub(dist, "dist") }
