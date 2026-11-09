package daemon

import (
	"testing"
	"time"
)

func TestWorkingFollowsARunFromStartToFinish(t *testing.T) {
	r := &Runner{}
	before := time.Now()
	r.publish(Event{Job: "Fotos", Phase: "started"})

	w := r.Working()
	if len(w) != 1 || w[0].Job != "Fotos" || w[0].Started.Before(before) || w[0].Total != 0 {
		t.Fatalf("a run that only started shows as %+v", w)
	}

	r.publish(Event{Job: "Fotos", Phase: "progress", Stage: "list", Done: 900, Total: 1000})
	if w := r.Working(); w[0].Total != 0 {
		t.Errorf("reading the sides counted as work done: %+v", w[0])
	}
	r.publish(Event{Job: "Fotos", Phase: "progress", Done: 3, Total: 12})
	if w := r.Working(); w[0].Done != 3 || w[0].Total != 12 {
		t.Errorf("after three of twelve steps the run shows %+v", w[0])
	}

	r.publish(Event{Job: "Fotos", Phase: "finished"})
	if w := r.Working(); len(w) != 0 {
		t.Errorf("a finished run is still working: %+v", w)
	}
}

func TestWorkingListsRunsOldestFirst(t *testing.T) {
	r := &Runner{}
	r.publish(Event{Job: "b", Phase: "started"})
	time.Sleep(time.Millisecond)
	r.publish(Event{Job: "a", Phase: "started"})
	if w := r.Working(); len(w) != 2 || w[0].Job != "b" || w[1].Job != "a" {
		t.Fatalf("the runs come as %+v", w)
	}
}
