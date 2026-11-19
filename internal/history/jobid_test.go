package history

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/jobid"
)

// oldLayout is the run table as it stood before jobs had ids, holding two
// runs of photos.
func oldLayout(t *testing.T, path string, at time.Time) {
	t.Helper()
	ctx := context.Background()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	for _, q := range []string{
		`CREATE TABLE runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, started INTEGER NOT NULL, finished INTEGER NOT NULL,
			copied INTEGER NOT NULL, moved INTEGER NOT NULL, trashed INTEGER NOT NULL, conflicts INTEGER NOT NULL,
			dirs_made INTEGER NOT NULL, dirs_removed INTEGER NOT NULL, unchanged INTEGER NOT NULL, skipped INTEGER NOT NULL,
			err TEXT NOT NULL)`,
		`CREATE INDEX runs_job_started ON runs (job, started DESC)`,
	} {
		if _, err := raw.ExecContext(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	for i := range 2 {
		started := at.Add(time.Duration(i) * time.Hour)
		if _, err := raw.ExecContext(ctx,
			`INSERT INTO runs (job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err)
			 VALUES ('photos', ?, ?, 4, 0, 0, 0, 0, 0, 0, 0, '')`, started.UnixNano(), started.Add(time.Minute).UnixNano()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRunsFromBeforeJobIDsAreFiledUnderTheIDTheJobIsGiven(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	at := time.Date(2026, 3, 1, 9, 0, 0, 0, time.Local)
	oldLayout(t, path, at)

	db, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open the older history: %v", err)
	}
	defer db.Close()
	id := jobid.Legacy("photos")
	runs, err := db.Recent(ctx, id, ShowAll, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || runs[0].JobID != id || runs[0].Job != "photos" {
		t.Fatalf("the job's id finds %+v, want both older runs of photos", runs)
	}
	if when, ok, err := db.LastSuccess(ctx, id); err != nil || !ok || !when.Equal(at.Add(time.Hour+time.Minute)) {
		t.Errorf("the last success is %v, %v, %v; want the newer older run", when, ok, err)
	}
}

func TestARelabelledJobListsItsOlderRunsUnderItsNewName(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	at := time.Date(2026, 3, 1, 9, 0, 0, 0, time.Local)
	for _, r := range []Run{
		{JobID: "aaaaaaaaaaaa", Job: "photos", Started: at, Finished: at.Add(time.Minute)},
		{JobID: "bbbbbbbbbbbb", Job: "music", Started: at, Finished: at.Add(time.Minute)},
	} {
		if err := db.Record(ctx, r, nil); err != nil {
			t.Fatal(err)
		}
	}
	going := db.Begin(Run{JobID: "aaaaaaaaaaaa", Job: "photos", Started: at.Add(time.Hour)})
	defer going.Drop()

	if err := db.Relabel(ctx, map[string]string{"aaaaaaaaaaaa": "pictures", "bbbbbbbbbbbb": "music"}); err != nil {
		t.Fatal(err)
	}
	runs, err := db.Following(ctx, "", ShowAll, time.Time{}, time.Time{}, 10)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]int{}
	for _, r := range runs {
		names[r.Job]++
	}
	if names["pictures"] != 2 || names["music"] != 1 || names["photos"] != 0 {
		t.Errorf("the runs are listed under %v, want both of the renamed job under pictures", names)
	}
}

func TestTheChartKeepsARenamedJobOnOneLine(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 3, 10, 12, 0, 0, 0, time.Local)
	for i, name := range []string{"photos", "pictures"} {
		started := now.Add(-time.Duration(i+1) * time.Hour)
		if err := db.Record(ctx, Run{JobID: "aaaaaaaaaaaa", Job: name, Started: started, Finished: started.Add(time.Minute), Copied: 1}, nil); err != nil {
			t.Fatal(err)
		}
	}
	stats, err := db.Summary(ctx, StatsQuery{Days: 1, ByJob: true, Now: now, In: time.Local})
	if err != nil {
		t.Fatal(err)
	}
	if len(stats.Rows) != 1 || stats.Rows[0].Copied != 2 {
		t.Errorf("the chart has %+v, want one line holding both runs", stats.Rows)
	}
}
