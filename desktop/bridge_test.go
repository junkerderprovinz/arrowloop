package main

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

func phases(evs []daemon.Event) []string {
	out := make([]string, 0, len(evs))
	for _, ev := range evs {
		out = append(out, ev.Job+":"+ev.Phase)
	}
	return out
}

func TestTheBridgeKeepsOnlyTheNewestProgress(t *testing.T) {
	b := newBridge()
	b.add(daemon.Event{Job: "photos", Phase: "started"})
	for i := 1; i <= 1000; i++ {
		b.add(daemon.Event{Job: "photos", Phase: "progress", Done: i, Total: 1000})
	}
	got := b.take()
	if len(got) != 2 {
		t.Fatalf("a thousand steps became %d events: %v", len(got), phases(got))
	}
	if got[0].Phase != "started" {
		t.Errorf("progress landed before the start: %v", phases(got))
	}
	if got[1].Done != 1000 {
		t.Errorf("the window was left at step %d of 1000", got[1].Done)
	}
	if again := b.take(); len(again) != 0 {
		t.Errorf("the same events went out twice: %v", phases(again))
	}
}

// A progress frame sent after the finish would put a finished job back on
// "running" until the next event.
func TestAFinishDropsTheProgressBeforeIt(t *testing.T) {
	b := newBridge()
	b.add(daemon.Event{Job: "photos", Phase: "started"})
	b.add(daemon.Event{Job: "photos", Phase: "progress", Done: 3, Total: 9})
	b.add(daemon.Event{Job: "photos", Phase: "moving"})
	b.add(daemon.Event{Job: "photos", Phase: "finished"})
	got := phases(b.take())
	want := []string{"photos:started", "photos:finished"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("sent %v, expected %v", got, want)
	}
}

func TestANewRunStartsAfterTheOldOneFinished(t *testing.T) {
	b := newBridge()
	b.add(daemon.Event{Job: "photos", Phase: "finished"})
	b.add(daemon.Event{Job: "photos", Phase: "started"})
	b.add(daemon.Event{Job: "photos", Phase: "progress", Done: 1, Total: 5})
	got := phases(b.take())
	want := []string{"photos:finished", "photos:started", "photos:progress"}
	if len(got) != len(want) {
		t.Fatalf("sent %v, expected %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sent %v, expected %v", got, want)
		}
	}
}

// Every job's latest state has to arrive, not only the busiest one's.
func TestEachJobKeepsItsOwnProgress(t *testing.T) {
	b := newBridge()
	b.add(daemon.Event{Job: "photos", Phase: "progress", Done: 1})
	b.add(daemon.Event{Job: "music", Phase: "progress", Done: 2})
	b.add(daemon.Event{Job: "photos", Phase: "progress", Done: 3})
	done := map[string]int{}
	for _, ev := range b.take() {
		done[ev.Job] = ev.Done
	}
	if done["photos"] != 3 || done["music"] != 2 {
		t.Errorf("the windows would show %v", done)
	}
}
