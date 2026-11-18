package plan

import (
	"context"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

const day = 24 * time.Hour

// aged is a one-way comparison that holds back files younger than thirty
// days, measured from base.
func aged(dir Direction, mode Mode) Options {
	return Options{ModWindow: 2 * time.Second, Direction: dir, Mode: mode, MinAge: 30 * day, Now: base}
}

func TestAYoungFileStaysOnTheSource(t *testing.T) {
	p, err := Build(context.Background(),
		listing(scan.Side{
			"new.jpg": live("new.jpg", 10, -2*day),
			"old.jpg": live("old.jpg", 20, -40*day),
		}),
		listing(scan.Side{}),
		map[string]state.Entry{},
		aged(LeftToRight, ModeMove),
	)
	if err != nil {
		t.Fatal(err)
	}
	if a, ok := find(p, "new.jpg"); ok {
		t.Fatalf("a two-day-old file was sent by a job that waits thirty days: %v", a.Kind)
	}
	if a, ok := find(p, "old.jpg"); !ok || a.Kind != Relocate {
		t.Fatalf("a forty-day-old file was not moved: %+v", p.Actions)
	}
	if p.Young != 1 {
		t.Fatalf("Young = %d, want 1", p.Young)
	}
	if len(p.Skipped) != 0 {
		t.Fatalf("a file held back by its age counts as left for later: %+v", p.Skipped)
	}
}

func TestAYoungEditWaitsBeforeItOverwritesTheDestination(t *testing.T) {
	prev := map[string]state.Entry{"notes.txt": agreed("notes.txt", 5, 5, -90*day, -90*day)}
	p, err := Build(context.Background(),
		listing(scan.Side{"notes.txt": live("notes.txt", 8, -1*day)}),
		listing(scan.Side{"notes.txt": live("notes.txt", 5, -90*day)}),
		prev,
		aged(LeftToRight, ModeSync),
	)
	if err != nil {
		t.Fatal(err)
	}
	if a, ok := find(p, "notes.txt"); ok {
		t.Fatalf("a day-old edit was sent by a job that waits thirty days: %v", a.Kind)
	}
}

func TestTheAgeHoldsOnlyWhatLeavesTheSource(t *testing.T) {
	// Mirror removes from the destination what the source deleted, whatever
	// the age of the copy left there.
	prev := map[string]state.Entry{
		"gone.jpg": agreed("gone.jpg", 5, 5, -1*day, -1*day),
		"keep.jpg": agreed("keep.jpg", 5, 5, -90*day, -90*day),
	}
	p, err := Build(context.Background(),
		listing(scan.Side{"keep.jpg": live("keep.jpg", 5, -90*day)}),
		listing(scan.Side{"gone.jpg": live("gone.jpg", 5, -1*day), "keep.jpg": live("keep.jpg", 5, -90*day)}),
		prev,
		aged(LeftToRight, ModeMirror),
	)
	if err != nil {
		t.Fatal(err)
	}
	if a, ok := find(p, "gone.jpg"); !ok || a.Kind != Delete || a.Dst != Right {
		t.Fatalf("mirror kept a young copy the source deleted: %+v", p.Actions)
	}
}

func TestATwoWayJobIgnoresTheAge(t *testing.T) {
	p, err := Build(context.Background(),
		listing(scan.Side{"new.jpg": live("new.jpg", 10, -2*day)}),
		listing(scan.Side{}),
		map[string]state.Entry{},
		aged(Both, ModeSync),
	)
	if err != nil {
		t.Fatal(err)
	}
	if a, ok := find(p, "new.jpg"); !ok || a.Kind != Copy {
		t.Fatalf("a two-way job held a file back by its age: %+v", p.Actions)
	}
	if p.Young != 0 {
		t.Fatalf("Young = %d in a two-way job", p.Young)
	}
}

func TestAFileDatedAheadOfTheClockIsYoung(t *testing.T) {
	// As rclone's --min-age has it: a file from the future has no age yet.
	p, err := Build(context.Background(),
		listing(scan.Side{"ahead.jpg": live("ahead.jpg", 10, time.Hour)}),
		listing(scan.Side{}),
		map[string]state.Entry{},
		aged(LeftToRight, ModeSync),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := find(p, "ahead.jpg"); ok || p.Young != 1 {
		t.Fatalf("a file dated an hour ahead was sent: %+v", p.Actions)
	}
}
