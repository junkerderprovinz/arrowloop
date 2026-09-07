package main

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// The tray's job rows are a fixed block, filled from the configuration each
// time the menu opens. That shape is not an implementation detail: a systray
// menu cannot grow after it has been shown, so a row added per job would work
// on the first run and quietly stop working the moment somebody added a job.
//
// jobRowTitles is the part of that which can be checked without a notification
// area, and it is where the mistake would be: an off-by-one at the boundary
// shows up as the last job never being offered, which is invisible until
// somebody has precisely that many jobs.

func named(names ...string) []job.Job {
	out := make([]job.Job, 0, len(names))
	for _, n := range names {
		out = append(out, job.Job{Name: n})
	}
	return out
}

func TestEveryJobUpToTheLimitIsOffered(t *testing.T) {
	rows := jobRowTitles(named("photos", "music", "docs"), 6)
	if len(rows) != 6 {
		t.Fatalf("got %d rows, the block is 6", len(rows))
	}
	for i, want := range []string{"photos", "music", "docs"} {
		if rows[i].name != want {
			t.Errorf("row %d starts %q, expected %q", i, rows[i].name, want)
		}
		if rows[i].title == "" {
			t.Errorf("row %d has a job and no words", i)
		}
	}
}

func TestAnUnusedRowCarriesNothingAtAll(t *testing.T) {
	// Both halves, because either one alone is a bug that hides: a row with a
	// title and no name is a menu entry that does nothing when pressed, and a
	// row with a name and no title is an invisible entry that starts a job.
	rows := jobRowTitles(named("photos"), 4)
	for i := 1; i < len(rows); i++ {
		if rows[i].name != "" || rows[i].title != "" {
			t.Errorf("unused row %d carries %+v", i, rows[i])
		}
	}
}

func TestTheLastRowIsUsed(t *testing.T) {
	// The off-by-one this file exists for. With exactly as many jobs as rows,
	// every row must carry one; a loop that stopped one short would look correct
	// on every other input.
	rows := jobRowTitles(named("a", "b", "c"), 3)
	for i, r := range rows {
		if r.name == "" {
			t.Errorf("row %d is empty with exactly as many jobs as rows", i)
		}
	}
}

func TestMoreJobsThanRowsDoesNotReachPastTheBlock(t *testing.T) {
	// A read past the end here is a panic inside the notification area: no
	// window, no message, the program simply disappears.
	rows := jobRowTitles(named("a", "b", "c", "d", "e"), 2)
	if len(rows) != 2 {
		t.Fatalf("the block grew to %d against the 2 built", len(rows))
	}
	if rows[0].name != "a" || rows[1].name != "b" {
		t.Errorf("the first two jobs are not the ones offered: %+v", rows)
	}
}

func TestTheJobBlockIsBiggerThanTheActivityBlock(t *testing.T) {
	// Not a style point. Activity is bounded by what is running right now, and
	// almost nothing runs many jobs at once; a job list is bounded by how many
	// somebody has, which is a different and larger number. Sizing them the same
	// would hide jobs on a machine that is doing nothing at all.
	if jobLines <= activityLines {
		t.Errorf("jobLines is %d and activityLines is %d", jobLines, activityLines)
	}
}
