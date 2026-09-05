package pathid

import "testing"

// The same name as the three filesystems actually store it.
const (
	nfc = "Müller.txt"  // one code point for the umlaut
	nfd = "Müller.txt" // u followed by a combining diaeresis
)

func TestNormalisationUnitesTheTwoSpellings(t *testing.T) {
	if nfc == nfd {
		t.Fatal("the two constants are the same bytes, so this test proves nothing")
	}
	if !SameKey(nfc, nfd, false) {
		t.Errorf("the composed and decomposed spellings of the same name did not match:\n  %q\n  %q", Key(nfc, false), Key(nfd, false))
	}
}

func TestCaseFoldingIsOptional(t *testing.T) {
	if SameKey("Bild.jpg", "bild.jpg", false) {
		t.Error("a case-sensitive job treated two different names as one file")
	}
	if !SameKey("Bild.jpg", "bild.jpg", true) {
		t.Error("a case-insensitive job failed to see one file under two spellings")
	}
}

// Folding must not undo the normalisation, and normalisation must not undo the
// folding. Getting the order wrong here produces a matcher that works for
// ASCII and quietly fails on the first accented name.
func TestFoldingAndNormalisationCompose(t *testing.T) {
	if !SameKey("MÜLLER.txt", nfd, true) {
		t.Errorf("an uppercase composed name did not match a lowercase decomposed one: %q vs %q",
			Key("MÜLLER.txt", true), Key(nfd, true))
	}
}

// The key is for matching only. It must never be handed to a backend as a name,
// and this test is here to make that visible: the key of a decomposed path is
// not the path.
func TestKeyIsNotThePath(t *testing.T) {
	if Key(nfd, false) == nfd {
		t.Error("the decomposed path came back unchanged, so nothing was normalised")
	}
	if Key(nfc, false) != nfc {
		t.Error("an already composed path should survive normalisation untouched")
	}
}
