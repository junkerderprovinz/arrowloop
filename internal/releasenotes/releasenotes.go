// Package releasenotes carries ArrowLoop's release notes inside the binary, so
// the What's new window reads them from the engine it talks to: offline, with
// no rate limit, and from the same origin the page is allowed to call.
package releasenotes

import (
	"embed"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// The copies of .github/release-notes; go:embed cannot reach outside the
// package directory.
//
//go:embed notes/*.md
var notesFS embed.FS

// Note is one release's notes in Markdown.
type Note struct {
	Version string `json:"version"`
	Body    string `json:"body"`
}

var core = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)

// parse reads the x.y.z a version string starts from, so "v1.8.0-12-gabc"
// counts as 1.8.0.
func parse(version string) ([3]int, bool) {
	m := core.FindStringSubmatch(version)
	if m == nil {
		return [3]int{}, false
	}
	var v [3]int
	for i := range v {
		v[i], _ = strconv.Atoi(m[i+1])
	}
	return v, true
}

func compare(a, b [3]int) int {
	return slices.Compare(a[:], b[:])
}

// UpTo returns the notes of every release up to and including running, newest
// first. A build without a version number, such as "dev", gets all of them.
func UpTo(running string) []Note {
	limit, bounded := parse(running)
	entries, _ := notesFS.ReadDir("notes")
	type versioned struct {
		v    [3]int
		note Note
	}
	var found []versioned
	for _, e := range entries {
		tag := strings.TrimSuffix(e.Name(), ".md")
		v, ok := parse(tag)
		if !ok || bounded && compare(v, limit) > 0 {
			continue
		}
		body, _ := notesFS.ReadFile("notes/" + e.Name())
		found = append(found, versioned{v, Note{Version: tag, Body: strings.TrimSpace(string(body))}})
	}
	slices.SortFunc(found, func(a, b versioned) int { return compare(b.v, a.v) })
	notes := make([]Note, len(found))
	for i, f := range found {
		notes[i] = f.note
	}
	return notes
}
