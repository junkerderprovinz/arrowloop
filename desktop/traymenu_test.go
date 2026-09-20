package main

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

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
	// A title without a name does nothing when pressed; a name without a title
	// is an invisible entry that starts a job.
	rows := jobRowTitles(named("photos"), 4)
	for i := 1; i < len(rows); i++ {
		if rows[i].name != "" || rows[i].title != "" {
			t.Errorf("unused row %d carries %+v", i, rows[i])
		}
	}
}

func TestTheLastRowIsUsed(t *testing.T) {
	// A loop that stopped one short would pass on every other input.
	rows := jobRowTitles(named("a", "b", "c"), 3)
	for i, r := range rows {
		if r.name == "" {
			t.Errorf("row %d is empty with exactly as many jobs as rows", i)
		}
	}
}

func TestMoreJobsThanRowsDoesNotReachPastTheBlock(t *testing.T) {
	// A panic inside the notification area makes the program vanish silently.
	rows := jobRowTitles(named("a", "b", "c", "d", "e"), 2)
	if len(rows) != 2 {
		t.Fatalf("the block grew to %d against the 2 built", len(rows))
	}
	if rows[0].name != "a" || rows[1].name != "b" {
		t.Errorf("the first two jobs are not the ones offered: %+v", rows)
	}
}

func TestTheJobBlockIsBiggerThanTheActivityBlock(t *testing.T) {
	// Few jobs run at once, but somebody may have many.
	if jobLines <= activityLines {
		t.Errorf("jobLines is %d and activityLines is %d", jobLines, activityLines)
	}
}
