// Package pathid decides when two file names on two different systems mean the
// same file.
//
// macOS stores names decomposed ("u" plus a combining diaeresis), Windows and
// Linux store them composed. Matching on the raw bytes would see "Müller.txt"
// as two different files and copy each to the other side on every run.
package pathid

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

// Key returns the identity a path is matched by. It is only used to line the
// two sides and the record up against each other; the real path is what goes
// to the backend.
//
// foldCase should be true when either side is case-insensitive. It is decided
// per job, because folding on one side only would map two files onto one and
// make the engine oscillate between them.
func Key(p string, foldCase bool) string {
	k := norm.NFC.String(p)
	if foldCase {
		// Filesystem case-insensitivity is not Unicode case folding either
		// (NTFS uses a fixed uppercase table), and ToLower is closer to it and
		// safe for concurrent use.
		k = strings.ToLower(k)
	}
	return k
}

// SameKey reports whether two paths refer to the same file under the given
// rules.
func SameKey(a, b string, foldCase bool) bool {
	return Key(a, foldCase) == Key(b, foldCase)
}
