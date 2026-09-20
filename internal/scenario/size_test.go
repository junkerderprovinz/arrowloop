package scenario

import (
	"os"
	"path/filepath"
	"testing"
)

// The sizes are read back from the entries a real run recorded, which is what
// the activity log shows.
func TestACopyRecordsHowManyBytesItMoved(t *testing.T) {
	j := newJob(t, quick())

	// Three different lengths, so a mixed-up mapping cannot pass.
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

// On trees already in sync nearly every log line is a "record", so those need
// a size too.
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
	// A second file that stays, or the emptied side would be refused as
	// unmounted.
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
