package daemon

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

func TestReadingSendsEachNewStageAndThinsOutTheCounts(t *testing.T) {
	r := &Runner{}
	events, stop := r.Subscribe()
	defer stop()

	w := &readingFor{runner: r, job: "music"}
	for i := range 1000 {
		w.report(scan.Reading{Stage: scan.StageList, Side: "left", Done: i, Total: 900, Guess: true})
	}
	w.report(scan.Reading{Stage: scan.StageList, Side: "right"})

	var got []Event
	for len(events) > 0 {
		got = append(got, <-events)
	}
	if len(got) != 2 {
		t.Fatalf("sent %d events for two stages reported within a moment, want 2: %+v", len(got), got)
	}
	first := got[0]
	if first.Phase != "progress" || first.Job != "music" || first.Stage != "list" || first.Side != "left" || first.Total != 900 || !first.Guess {
		t.Errorf("first event is %+v, want the left listing of music against a guessed 900", first)
	}
	if got[1].Side != "right" {
		t.Errorf("second event is %+v, want the right listing", got[1])
	}
}
