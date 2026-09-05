// Package pathid decides when two file names on two different systems mean the
// same file.
//
// This is not a detail. macOS stores names decomposed (NFC "ü" becomes "u" plus
// a combining diaeresis), Windows and Linux store them composed. "Müller.txt"
// is then the same file on both sides and a different sequence of bytes, so an
// engine that matches on the raw name sees a file that exists only on the left
// and a file that exists only on the right. It copies each one to the other
// side, and on the next run it does it again, forever, growing the tree by two
// files per round. Every sync tool has had this bug at least once.
package pathid

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

// Key returns the identity a path is matched by, which is deliberately not the
// path itself. The real path stays with the side it came from and is what gets
// handed to the backend; the key is only ever used to line the two sides up
// against each other and against the record.
//
// foldCase should be true when EITHER side cannot tell "Bild.jpg" from
// "bild.jpg". It has to be decided per job rather than per side: if only one
// side folds and the matching does not, the other side's two files both map
// onto the one file over there, and the engine oscillates between them.
func Key(p string, foldCase bool) string {
	k := norm.NFC.String(p)
	if foldCase {
		// Plain lowercasing rather than full Unicode case folding, on purpose.
		// Filesystem case-insensitivity is not Unicode case folding either:
		// NTFS uses one fixed uppercase table decided when the volume was
		// formatted, and it does not follow locale rules. Approximating it with
		// ToLower is closer to the truth than a linguistically correct fold
		// would be, and it has no hidden state, so it is safe to call from
		// several goroutines once scanning runs in parallel.
		k = strings.ToLower(k)
	}
	return k
}

// SameKey reports whether two paths refer to the same file under the given
// rules.
func SameKey(a, b string, foldCase bool) bool {
	return Key(a, foldCase) == Key(b, foldCase)
}
