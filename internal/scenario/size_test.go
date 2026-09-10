package scenario

import (
	"os"
	"path/filepath"
	"testing"
)

// The per-file log promises what a run cost, and a size of zero is not a cost.
//
// jdp, looking at the running container: "im aktivitätslog ist die dateigröße
// nicht sichtbar." The database said why - 25515 entries, 24758 of them copies,
// and not ONE of them carrying a size. Not old rows either: the column has been
// there for days and the test jobs write into it constantly. The write path was
// simply never producing a number.
//
// So this asserts the thing the screen shows rather than the thing the code
// says: run a real sync of files whose sizes are known, and read the sizes back
// off the entries the run recorded. A unit test on `sizeOf` would have passed
// throughout, because `sizeOf` was never the part that was wrong.
func TestACopyRecordsHowManyBytesItMoved(t *testing.T) {
	j := newJob(t, quick())

	// Three files, three different lengths, so a mixed-up mapping cannot pass
	// by accident: one wrong size would still be one of these three numbers.
	want := map[string]int64{
		"klein.txt":       4,
		"mittel.txt":      40,
		"unter/gross.txt": 400,
	}
	write(t, j.left, "klein.txt", string(make([]byte, 4)))
	write(t, j.left, "mittel.txt", string(make([]byte, 40)))
	write(t, j.left, "unter/gross.txt", string(make([]byte, 400)))

	_, res := j.sync(t)

	got := map[string]int64{}
	for _, e := range res.Entries {
		if e.Kind == "copy" {
			got[e.Path] = e.Size
		}
	}
	if len(got) != len(want) {
		t.Fatalf("recorded %d copies, wanted %d: %v", len(got), len(want), got)
	}
	for path, size := range want {
		if got[path] != size {
			t.Errorf("%s was recorded as %d bytes, it is %d", path, got[path], size)
		}
	}
}

// A file both sides already had is still a file with a size.
//
// This is the row that matters most, and the one that looked broken: on a pair
// of trees that are in sync, nearly every line of the activity log is a
// "record" - nothing was transferred, the two sides simply agreed. With no size
// on those, the column is blank on 696 lines out of 697 and the one line that
// carries a number is easy to miss entirely.
func TestAnAgreedFileRecordsItsSizeToo(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "beide.txt", string(make([]byte, 321)))
	write(t, j.right, "beide.txt", string(make([]byte, 321)))

	_, res := j.sync(t)

	var seen int64 = -1
	for _, e := range res.Entries {
		if e.Kind == "record" && e.Path == "beide.txt" {
			seen = e.Size
		}
	}
	if seen != 321 {
		t.Errorf("the agreed file was recorded as %d bytes, it is 321", seen)
	}
}

// A deletion has a size too: it is how much room came back.
func TestATrashedFileRecordsWhatItWeighed(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "weg.txt", string(make([]byte, 123)))
	// A second file that stays: a side that lists NOTHING at all is refused as
	// unmounted rather than treated as a mass deletion, and a one-file tree
	// emptied is exactly that case.
	write(t, j.left, "bleibt.txt", string(make([]byte, 7)))
	j.sync(t)

	if err := os.Remove(filepath.Join(j.left, "weg.txt")); err != nil {
		t.Fatalf("delete: %v", err)
	}
	_, res := j.sync(t)

	var seen int64 = -1
	for _, e := range res.Entries {
		if e.Kind == "trash" {
			seen = e.Size
		}
	}
	if seen != 123 {
		t.Errorf("the trashed file was recorded as %d bytes, it was 123", seen)
	}
}
