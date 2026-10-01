package main

import (
	"slices"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

func TestSyncNowStartsEveryJobThatCanRun(t *testing.T) {
	jobs := []job.Job{
		{Name: "photos", Left: "/a", Right: "/b"},
		{Name: "off", Left: "/a", Right: "/b", Disabled: true},
		{Name: "draft", Left: "/a"},
		{Name: "busy", Left: "/a", Right: "/b"},
		{Name: "music", Left: "/c", Right: "/d"},
	}
	got := startable(jobs, map[string]bool{"busy": true})
	if want := []string{"photos", "music"}; !slices.Equal(got, want) {
		t.Errorf("Force sync starts %v, expected %v", got, want)
	}
}

func TestTheTooltipSaysWhatIsGoingOn(t *testing.T) {
	l := newTrayLive(&TraySet{})
	german := deskset.Words{Paused: "Sync ist pausiert", Running: "laufende Jobs: {count}", Done: "fertig"}
	l.words = german

	if got := l.tooltip(); got != "ArrowLoop" {
		t.Errorf("a fresh start says %q", got)
	}

	l.follow(daemon.Event{Job: "photos", Phase: "started"})
	l.follow(daemon.Event{Job: "photos", Phase: "progress", Done: 3, Total: 10})
	if got := l.tooltip(); got != "ArrowLoop - photos: 3/10" {
		t.Errorf("one running job says %q", got)
	}

	l.follow(daemon.Event{Job: "music", Phase: "started"})
	if got := l.tooltip(); got != "ArrowLoop - laufende Jobs: 2" {
		t.Errorf("two running jobs say %q", got)
	}

	l.follow(daemon.Event{Job: "music", Phase: "finished", Error: "disk full"})
	l.follow(daemon.Event{Job: "photos", Phase: "finished"})
	if got := l.tooltip(); got != "ArrowLoop - photos: fertig" {
		t.Errorf("after both finished it says %q", got)
	}

	l.paused = true
	if got := l.tooltip(); got != "ArrowLoop - Sync ist pausiert" {
		t.Errorf("a paused app says %q", got)
	}
}

// Another job still running when one fails must not let a later success
// paint over the red.
func TestAFailureOutlastsASuccessWhileOthersRun(t *testing.T) {
	l := newTrayLive(&TraySet{})
	l.follow(daemon.Event{Job: "a", Phase: "started"})
	l.follow(daemon.Event{Job: "b", Phase: "started"})
	l.follow(daemon.Event{Job: "c", Phase: "started"})
	l.follow(daemon.Event{Job: "a", Phase: "finished", Error: "gone"})
	l.follow(daemon.Event{Job: "b", Phase: "finished"})
	if l.state != TrayFailed {
		t.Errorf("a success while another job ran hid the failure: state %d", l.state)
	}
	l.follow(daemon.Event{Job: "c", Phase: "finished"})
	if l.state != TraySettled {
		t.Errorf("the last job to finish, cleanly, left state %d", l.state)
	}
}

func TestTheAutostartFlagKeepsASecondStartInTheTray(t *testing.T) {
	for _, args := range [][]string{
		{`C:\Program Files\ArrowLoop\ArrowLoop.exe`, "--tray"},
		{"/usr/bin/arrowloop", "-tray"},
	} {
		if !askedForTray(args) {
			t.Errorf("%v brought the window forward", args)
		}
	}
	if askedForTray([]string{`C:\Program Files\ArrowLoop\ArrowLoop.exe`}) {
		t.Error("a second start by hand stayed in the tray")
	}
}
