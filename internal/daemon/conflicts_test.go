package daemon_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// clash runs a job, edits name on both sides with the left edit older, and
// runs it again, so the second run keeps both versions.
func clash(t *testing.T, r *daemon.Runner, job, left, right, name string) {
	t.Helper()
	ctx := context.Background()
	put := func(dir, body string, when time.Time) {
		full := filepath.Join(dir, name)
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		if err := os.Chtimes(full, when, when); err != nil {
			t.Fatalf("stamp: %v", err)
		}
	}
	put(left, "first", time.Now().Add(-2*time.Hour))
	if _, err := r.Run(ctx, job); err != nil {
		t.Fatalf("first run of %s: %v", job, err)
	}
	put(left, "left edit", time.Now().Add(-time.Hour))
	put(right, "right edit", time.Now())
	rec, err := r.Run(ctx, job)
	if err != nil {
		t.Fatalf("second run of %s: %v", job, err)
	}
	if rec.Conflicts != 1 {
		t.Fatalf("%s met %d conflicts, want 1", job, rec.Conflicts)
	}
}

func twoJobs(t *testing.T, oneWay bool) (*daemon.Runner, *history.DB, [2][2]string) {
	t.Helper()
	var sides [2][2]string
	direction := ""
	if oneWay {
		direction = `,"direction":"leftToRight"`
	}
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		for i, name := range []string{"docs", "photos"} {
			for k, s := range []string{"left", "right"} {
				sides[i][k] = filepath.Join(dir, name+"-"+s)
				if err := os.MkdirAll(sides[i][k], 0o755); err != nil {
					t.Fatalf("mkdir: %v", err)
				}
			}
		}
		return fmt.Sprintf(`{"jobs":[
			{"name":"docs","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"},
			{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"%s}]}`,
			jsonPath(sides[0][0]), jsonPath(sides[0][1]), jsonPath(filepath.Join(dir, "docs.db")),
			jsonPath(sides[1][0]), jsonPath(sides[1][1]), jsonPath(filepath.Join(dir, "photos.db")), direction)
	})
	return daemon.New(cfg, hist, nil, nil), hist, sides
}

func TestConflictsAreListedAcrossEveryJob(t *testing.T) {
	r, _, sides := twoJobs(t, false)
	clash(t, r, "docs", sides[0][0], sides[0][1], "plan.txt")
	clash(t, r, "photos", sides[1][0], sides[1][1], "album.txt")

	all, unread := r.Conflicts(context.Background(), "")
	if len(unread) != 0 {
		t.Fatalf("a job could not be read: %+v", unread)
	}
	jobs := map[string]string{}
	for _, c := range all {
		jobs[c.Job] = c.Plain
	}
	if len(all) != 2 || jobs["docs"] != "plan.txt" || jobs["photos"] != "album.txt" {
		t.Fatalf("expected one conflict in each job, got %+v", all)
	}

	one, _ := r.Conflicts(context.Background(), "photos")
	if len(one) != 1 || one[0].Job != "photos" {
		t.Fatalf("asking for one job answered %+v", one)
	}
}

func TestADecisionIsARunInTheHistory(t *testing.T) {
	r, hist, sides := twoJobs(t, false)
	clash(t, r, "docs", sides[0][0], sides[0][1], "plan.txt")
	all, _ := r.Conflicts(context.Background(), "docs")

	rec, err := r.Decide(context.Background(), "docs", []apply.Decision{{Copy: all[0].Copy, Keep: plan.KeepRight}})
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if rec.Trashed != 2 || rec.Failed() {
		t.Fatalf("the decision should bin the copy on both sides: %+v", rec)
	}
	runs, err := hist.Recent(context.Background(), "docs", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 3 {
		t.Fatalf("expected the decision as a third run, got %d runs", len(runs))
	}
	entries, err := hist.Entries(context.Background(), runs[0].ID)
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	var said bool
	for _, e := range entries {
		if e.Kind == "conflict" && e.Path == "plan.txt" && e.Note == plan.KeepRight.String() {
			said = true
		}
	}
	if !said {
		t.Errorf("the run does not say how the conflict was decided: %+v", entries)
	}
	if left, _ := r.Conflicts(context.Background(), ""); len(left) != 0 {
		t.Errorf("the decided conflict is still listed: %+v", left)
	}
}

func TestAOneWayJobHasNoConflictsToDecide(t *testing.T) {
	r, _, _ := twoJobs(t, true)
	_, err := r.Decide(context.Background(), "photos", []apply.Decision{{Copy: "a.conflict-left-20260101-000000.txt"}})
	if !errors.Is(err, daemon.ErrOneWay) {
		t.Fatalf("expected ErrOneWay, got %v", err)
	}
}
