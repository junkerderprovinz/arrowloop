package history

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

// A history without the answered column gains it on open, and the runs it
// holds count as unanswered.
func TestAnsweredRunsAreLeftOutOfTheUsualOnes(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	db.Close()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	old := time.Date(2026, 3, 1, 9, 0, 0, 0, time.Local)
	for _, q := range []string{
		`ALTER TABLE runs DROP COLUMN answered`,
		`INSERT INTO runs (job, started, finished, copied, moved, trashed, conflicts, dirs_made, dirs_removed, unchanged, skipped, err)
		 VALUES ('test', ?, ?, 3, 0, 0, 0, 0, 0, 0, 0, '')`,
	} {
		if _, err := raw.ExecContext(ctx, q, old.UnixNano(), old.Add(time.Minute).UnixNano()); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	raw.Close()

	db, err = Open(ctx, path)
	if err != nil {
		t.Fatalf("open again: %v", err)
	}
	defer db.Close()
	allowed := old.Add(time.Hour)
	if err := db.Record(ctx, Run{Job: "test", Started: allowed, Finished: allowed.Add(time.Minute), Trashed: 30, Answered: true}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}

	usual, err := db.Recent(ctx, "test", ShowUsual, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(usual) != 1 || !usual[0].Started.Equal(old) {
		t.Errorf("the usual runs are %+v, want only the older one", usual)
	}
	all, err := db.Recent(ctx, "test", ShowAll, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(all) != 2 || !all[0].Answered || all[1].Answered {
		t.Errorf("the runs read back as %+v, want the newer one answered", all)
	}
}
