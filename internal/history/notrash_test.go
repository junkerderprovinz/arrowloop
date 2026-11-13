package history

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// A job without a trash deletes for good, and the history has to be able to
// say so for every run it lists, however the run came to be stored.
func TestARunWithoutATrashSaysSoWhereverItIsRead(t *testing.T) {
	ctx := context.Background()
	db := openAt(t, filepath.Join(t.TempDir(), "runs.db"))
	defer db.Close()
	at := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	if err := db.Record(ctx, Run{Job: "photos", Started: at, Finished: at, Trashed: 3, NoTrash: true}, nil); err != nil {
		t.Fatal(err)
	}
	if err := db.Record(ctx, Run{Job: "music", Started: at, Finished: at, Trashed: 2}, nil); err != nil {
		t.Fatal(err)
	}
	db.Begin(Run{Job: "photos", Started: at.Add(time.Hour), NoTrash: true})

	runs, err := db.Following(ctx, "", ShowAll, time.Time{}, time.Time{}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 3 || !runs[0].Running || !runs[0].NoTrash {
		t.Fatalf("the runs read %+v, want the running one first and without a trash", runs)
	}
	for _, r := range runs[1:] {
		if r.NoTrash != (r.Job == "photos") {
			t.Errorf("the run of %s reads NoTrash %v", r.Job, r.NoTrash)
		}
	}

	latest, err := db.Latest(ctx, at)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range latest {
		if l.NoTrash != (l.Job == "photos") {
			t.Errorf("the latest run of %s reads NoTrash %v", l.Job, l.NoTrash)
		}
	}
}

func TestARunCutOffByAKillKeepsSayingItHadNoTrash(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "runs.db")
	first := openAt(t, path)
	start := time.Now().Add(-10 * time.Minute)
	live := first.Begin(Run{Job: "photos", Started: start, NoTrash: true})
	live.Add(Entry{Kind: "trash", Side: "right", Path: "a.jpg", Size: 10})
	if err := first.checkpoint(ctx, start.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	kill(first)

	again := openAt(t, path)
	defer again.Close()
	runs, err := again.Recent(ctx, "photos", ShowAll, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].Err != Interrupted || runs[0].Trashed != 1 || !runs[0].NoTrash {
		t.Errorf("the interrupted run was recorded as %+v, want one deletion without a trash", runs)
	}
}

func TestTheSummaryCountsDeletionsWithoutATrashApart(t *testing.T) {
	ctx := context.Background()
	db := openAt(t, filepath.Join(t.TempDir(), "runs.db"))
	defer db.Close()
	now := time.Date(2027, 3, 10, 12, 0, 0, 0, time.UTC)
	for _, r := range []Run{
		{Job: "photos", Started: now, Finished: now, Trashed: 3},
		{Job: "music", Started: now, Finished: now, Trashed: 2, NoTrash: true},
	} {
		if err := db.Record(ctx, r, nil); err != nil {
			t.Fatal(err)
		}
	}
	got, err := db.Summary(ctx, StatsQuery{Days: 1, Now: now, In: time.UTC})
	if err != nil {
		t.Fatal(err)
	}
	if got.Totals.Trashed != 3 || got.Totals.Deleted != 2 {
		t.Errorf("the totals are %+v, want 3 to the trash and 2 deleted", got.Totals)
	}
}
