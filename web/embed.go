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

//go:embed all:dist
var built embed.FS

// Files is the built interface, rooted at dist so that "index.html" means what
// it says.
//
// A placeholder index.html is committed so this compiles before anyone has run
// the frontend build. It says so on the page rather than rendering an empty
// document, because a blank screen is indistinguishable from a broken one.
func Files() (fs.FS, error) { return fs.Sub(built, "dist") }
