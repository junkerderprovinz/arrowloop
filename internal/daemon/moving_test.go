package daemon

import (
	"encoding/json"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/engine"
)

// The wire shape a screen reads, because that is the whole contract.
//
// jdp: "autosync zeigt in der übersicht immer die einzelnen dateien die grade
// hoch und runtergeladen werden mit progress bar." Everything between rclone's
// accounting and a drawn bar is names in JSON, and a renamed field would show
// up as rows that never appear rather than as anything that fails.
func TestAMovingFrameCarriesTheFilesAndTheirSizes(t *testing.T) {
	raw, err := json.Marshal(Event{
		Job:   "Fotos",
		Phase: "moving",
		Moving: []engine.Moving{
			{Path: "urlaub/strand.jpg", Bytes: 512, Size: 2048, Side: "right"},
			{Path: "urlaub/berg.jpg", Bytes: 10, Size: -1},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var back struct {
		Job    string `json:"job"`
		Phase  string `json:"phase"`
		Moving []struct {
			Path  string `json:"path"`
			Bytes int64  `json:"bytes"`
			Size  int64  `json:"size"`
			Side  string `json:"side"`
		} `json:"moving"`
	}
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if back.Phase != "moving" {
		t.Errorf("phase is %q, and a screen keys on it", back.Phase)
	}
	if len(back.Moving) != 2 {
		t.Fatalf("got %d files in the air, want 2: %s", len(back.Moving), raw)
	}
	if back.Moving[0].Path != "urlaub/strand.jpg" || back.Moving[0].Bytes != 512 || back.Moving[0].Size != 2048 {
		t.Errorf("the first file came back as %+v", back.Moving[0])
	}
	if back.Moving[0].Side != "right" {
		t.Errorf("the side is %q, and it is what draws the arrow", back.Moving[0].Side)
	}
	// A size nobody reported stays -1 rather than becoming 0. A bar drawn
	// against zero is a full bar, which is the most wrong of the answers
	// available for "we do not know how big this is".
	if back.Moving[1].Size != -1 {
		t.Errorf("an unknown size came back as %d", back.Moving[1].Size)
	}
}

// An empty list drops out of the JSON, and a reader has to take that as empty.
//
// Written down as a test rather than only as a comment, because the two halves
// live in different languages: the tag here decides what the screen sees, and
// nothing in the screen's own code would fail if this changed.
func TestAnEmptyMovingFrameArrivesWithoutTheField(t *testing.T) {
	raw, err := json.Marshal(Event{Job: "Fotos", Phase: "moving", Moving: []engine.Moving{}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, there := back["moving"]; there {
		t.Errorf("an empty list was sent as a field: %s", raw)
	}
	if back["phase"] != "moving" {
		t.Errorf("phase is %v, and it is the only thing that says the rows are gone", back["phase"])
	}
}

// A busy run sends its rate instead of rows, and the field has to survive JSON.
//
// This is the frame that replaced a blank space under a running job. Nothing on
// the screen's side would fail if the name changed here: the caption would
// simply never appear, which looks exactly like the bug it was built to fix.
func TestABusyFrameCarriesTheRateAndNoRows(t *testing.T) {
	raw, err := json.Marshal(Event{Job: "Fotos", Phase: "moving", Rate: 240})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back["rate"] != float64(240) {
		t.Errorf("the rate came back as %v: %s", back["rate"], raw)
	}
	if _, there := back["moving"]; there {
		t.Errorf("a busy frame carried rows as well: %s", raw)
	}

	// And a quiet frame carries no rate at all, so a screen cannot mistake
	// "nothing is moving" for "nothing is moving, at zero files a second".
	quiet, err := json.Marshal(Event{Job: "Fotos", Phase: "moving", Moving: []engine.Moving{{Path: "a.jpg"}}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// A FRESH map. Unmarshalling into one that already has keys MERGES into it,
	// so reusing the one above would have left `rate` standing from the first
	// frame and this check would have failed on a frame that was correct.
	var second map[string]any
	if err := json.Unmarshal(quiet, &second); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, there := second["rate"]; there {
		t.Errorf("a frame with rows carried a rate: %s", quiet)
	}
}

// Two readings that would draw the same rows are one frame, not two.
func TestOnlyAChangedReadingIsWorthSending(t *testing.T) {
	one := []engine.Moving{{Path: "a.jpg", Bytes: 10, Size: 100, Side: "right"}}
	cases := []struct {
		name string
		a, b []engine.Moving
		same bool
	}{
		{"nothing to nothing", nil, nil, true},
		{"nothing to empty, which is the same picture", nil, []engine.Moving{}, true},
		{"the same file at the same point", one, []engine.Moving{{Path: "a.jpg", Bytes: 10, Size: 100, Side: "right"}}, true},
		// The bytes are the whole reason this is checked at all: a file whose
		// counter moved is a row that moved.
		{"the same file, further along", one, []engine.Moving{{Path: "a.jpg", Bytes: 40, Size: 100, Side: "right"}}, false},
		{"a different file", one, []engine.Moving{{Path: "b.jpg", Bytes: 10, Size: 100, Side: "right"}}, false},
		{"one file became two", one, append(append([]engine.Moving{}, one...), engine.Moving{Path: "b.jpg"}), false},
		{"the last file finished", one, nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := sameMoving(c.a, c.b); got != c.same {
				t.Errorf("sameMoving = %v, want %v", got, c.same)
			}
		})
	}
}
