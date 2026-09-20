// Package webui embeds the built interface. It lives beside dist because
// //go:embed cannot reference a parent directory.
package webui

import (
	"embed"
	"io/fs"
)

// dist holds the frontend build. A fresh clone has only the keep-file there,
// which is enough for this to compile before the build has run.
//
//go:embed all:dist
var dist embed.FS

// Placeholder is the page served by a binary built without the interface.
//
//go:embed placeholder.html
var Placeholder []byte

// Files returns the built interface rooted at dist. It holds no index.html
// when the build was skipped.
func Files() (fs.FS, error) { return fs.Sub(dist, "dist") }
