package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// syncedPair is a job whose two sides hold the same forty files and have
// agreed on them once.
func syncedPair(t *testing.T) (r *Runner, left, right string) {
	t.Helper()
	root := t.TempDir()
	left, right = filepath.Join(root, "left"), filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	for i := range 40 {
		write(t, filepath.Join(left, fmt.Sprintf("datei-%02d.txt", i)), "first")
	}
	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })

	// The quiet period is off, or files written a moment ago would wait.
	cfg := &job.Config{
		Jobs:         []job.Job{{Name: "test", Left: left, Right: right, State: filepath.Join(root, "state.db"), QuietPeriod: "0s"}},
		ParallelJobs: 1,
	}
	r = New(cfg, hist, func(string, ...any) {})
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("the first run: %v", err)
	}
	return r, left, right
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func count(t *testing.T, dir string) int {
	t.Helper()
	found, err := filepath.Glob(filepath.Join(dir, "datei-*.txt"))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return len(found)
}

func emptyOut(t *testing.T, dir string, n int) {
	t.Helper()
	for i := range n {
		if err := os.Remove(filepath.Join(dir, fmt.Sprintf("datei-%02d.txt", i))); err != nil {
			t.Fatalf("remove: %v", err)
		}
	}
}

// held runs the job and returns the finding that holds it.
func held(t *testing.T, r *Runner) anomaly.Finding {
	t.Helper()
	if _, err := r.Run(context.Background(), "test"); !errors.Is(err, ErrHeld) {
		t.Fatalf("the run ended with %v, want it held", err)
	}
	open, _ := r.Findings(context.Background())
	if len(open) != 1 || !open[0].Held {
		t.Fatalf("got %d open findings, want the one that holds the job: %+v", len(open), open)
	}
	return open[0]
}

func TestARefusedRunHoldsTheJobAndIsNoFailure(t *testing.T) {
	r, left, right := syncedPair(t)
	emptyOut(t, left, 30)

	f := held(t, r)
	if f.Kind != anomaly.Delete || f.Count != 30 || f.Known != 40 || f.OnRight != 30 || len(f.Paths) != 30 {
		t.Errorf("the finding says %s, %d of %d, %d on the right, %d paths; want delete, 30 of 40, all on the right, all named",
			f.Kind, f.Count, f.Known, f.OnRight, len(f.Paths))
	}
	if count(t, right) != 40 {
		t.Errorf("the right side holds %d files after a refused run, want all 40", count(t, right))
	}

	// The first run is the only one in the log, and nothing counts as failed.
	runs, err := r.hist.Recent(context.Background(), "test", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}
	if len(runs) != 1 || runs[0].Failed() {
		t.Errorf("the log holds %d runs, want only the first, successful one", len(runs))
	}

	// A second look confirms the same finding and makes no second one.
	again := held(t, r)
	if again.ID != f.ID {
		t.Error("a second refused run made a new finding")
	}
}

func TestApprovingRunsExactlyTheShownChange(t *testing.T) {
	r, left, right := syncedPair(t)
	emptyOut(t, left, 30)
	f := held(t, r)

	// One more file goes after the finding was shown.
	if err := os.Remove(filepath.Join(left, "datei-35.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := r.Approve(context.Background(), f.ID); !errors.Is(err, ErrHeld) {
		t.Fatalf("approving a change that grew since ended with %v, want it held again", err)
	}
	grown := held(t, r)
	if grown.ID != f.ID || grown.Count != 31 || grown.Allowed {
		t.Fatalf("the finding says %d files, allowed %v; want the same finding with 31 and no permission left", grown.Count, grown.Allowed)
	}

	if _, err := r.Approve(context.Background(), grown.ID); err != nil {
		t.Fatalf("approving the shown change: %v", err)
	}
	if count(t, right) != 9 {
		t.Errorf("the right side holds %d files, want the 9 that were kept", count(t, right))
	}
	open, closed := r.Findings(context.Background())
	if len(open) != 0 || len(closed) != 1 || closed[0].Outcome != anomaly.Ran {
		t.Errorf("got %d open and %d closed findings, want one closed as run", len(open), len(closed))
	}
}

func TestTakingBackRestoresWhatWasDeleted(t *testing.T) {
	r, left, right := syncedPair(t)
	emptyOut(t, left, 30)
	f := held(t, r)

	rec, err := r.TakeBack(context.Background(), f.ID)
	if err != nil {
		t.Fatalf("take back: %v", err)
	}
	if rec.Copied != 30 || rec.Trashed != 0 {
		t.Errorf("taking back copied %d and removed %d, want 30 copied and nothing removed", rec.Copied, rec.Trashed)
	}
	if count(t, left) != 40 || count(t, right) != 40 {
		t.Errorf("the sides hold %d and %d files, want 40 each", count(t, left), count(t, right))
	}
	_, closed := r.Findings(context.Background())
	if len(closed) != 1 || closed[0].Outcome != anomaly.TakenBack {
		t.Errorf("the finding is not closed as taken back: %+v", closed)
	}
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Errorf("the run after taking back: %v", err)
	}
}

func TestTakingBackAChangeKeepsTheRewrittenContent(t *testing.T) {
	r, left, right := syncedPair(t)
	for i := range 30 {
		write(t, filepath.Join(left, fmt.Sprintf("datei-%02d.txt", i)), "encrypted, and longer")
	}
	f := held(t, r)
	if f.Kind != anomaly.Change || f.Severity != "critical" {
		t.Fatalf("got a %s finding that is %s, want a critical change", f.Kind, f.Severity)
	}

	if _, err := r.TakeBack(context.Background(), f.ID); err != nil {
		t.Fatalf("take back: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(left, "datei-00.txt"))
	if err != nil || string(got) != "first" {
		t.Errorf("the left side reads %q (%v), want the first content back", got, err)
	}
	if again, err := os.ReadFile(filepath.Join(right, "datei-00.txt")); err != nil || string(again) != "first" {
		t.Errorf("the right side reads %q (%v), want it untouched", again, err)
	}
	// The job keeps no versions, and this run kept one all the same.
	kept, err := filepath.Glob(filepath.Join(left, ".arrowloop", "versions", "datei-00.txt", "*"))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(kept) == 0 {
		t.Error("the rewritten content is gone, want it kept as a version")
	}
}

func TestACauseThatWentAwayClosesTheFinding(t *testing.T) {
	r, left, _ := syncedPair(t)
	emptyOut(t, left, 30)
	held(t, r)

	for i := range 30 {
		write(t, filepath.Join(left, fmt.Sprintf("datei-%02d.txt", i)), "first")
	}
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("the run after the files came back: %v", err)
	}
	open, closed := r.Findings(context.Background())
	if len(open) != 0 || len(closed) != 1 || closed[0].Outcome != anomaly.Resolved {
		t.Errorf("got %d open and %d closed findings, want one closed as resolved", len(open), len(closed))
	}
}

func TestAnEmptiedSideHoldsAndCanBeRefilled(t *testing.T) {
	r, left, right := syncedPair(t)
	emptyOut(t, left, 40)

	f := held(t, r)
	if f.Kind != anomaly.Empty || f.Side != "left" || f.Known != 40 {
		t.Fatalf("got a %s finding for the %s side knowing %d, want the left side empty with 40 known", f.Kind, f.Side, f.Known)
	}
	if _, err := r.TakeBack(context.Background(), f.ID); err != nil {
		t.Fatalf("take back: %v", err)
	}
	if count(t, left) != 40 || count(t, right) != 40 {
		t.Errorf("the sides hold %d and %d files, want 40 each", count(t, left), count(t, right))
	}
}

func TestRunsFailingInARowMakeANoteThatASuccessClears(t *testing.T) {
	r, _, right := syncedPair(t)
	hidden := right + "-away"
	if err := os.Rename(right, hidden); err != nil {
		t.Fatalf("rename: %v", err)
	}
	// A file where the folder was makes every run fail when it opens the side.
	write(t, right, "in the way")

	for i := range job.DefaultFailingAfter {
		if _, err := r.Run(context.Background(), "test"); err == nil {
			t.Fatalf("run %d succeeded against a side that is a file", i+1)
		}
	}
	open, _ := r.Findings(context.Background())
	if len(open) != 1 || open[0].Kind != anomaly.Failing || open[0].Held || open[0].Count != job.DefaultFailingAfter {
		t.Fatalf("got %+v, want one note about %d failures that holds nothing", open, job.DefaultFailingAfter)
	}

	// Seen once is enough: it stays away while the cause does not change.
	if err := r.Acknowledge(open[0].ID); err != nil {
		t.Fatalf("acknowledge: %v", err)
	}
	if _, err := r.Run(context.Background(), "test"); err == nil {
		t.Fatal("the run succeeded against a side that is a file")
	}
	if open, _ := r.Findings(context.Background()); len(open) != 0 {
		t.Errorf("an acknowledged note came back while nothing had changed: %+v", open)
	}

	if err := os.Remove(right); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := os.Rename(hidden, right); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := r.Run(context.Background(), "test"); err != nil {
		t.Fatalf("the run after the side came back: %v", err)
	}
	if open, _ := r.Findings(context.Background()); len(open) != 0 {
		t.Errorf("the note outlived a successful run: %+v", open)
	}
}

func TestAScheduleNotKeptMakesANote(t *testing.T) {
	r, _, _ := syncedPair(t)
	cfg := *r.config()
	cfg.Jobs = []job.Job{cfg.Jobs[0]}
	cfg.Jobs[0].Schedule = "@hourly"
	r.Reload(&cfg)

	r.overdue(context.Background(), time.Now().Add(24*time.Hour))
	if open, _ := r.anomalies.List(func(string) bool { return true }); len(open) != 0 {
		t.Fatalf("a day without a run made a note already: %+v", open)
	}
	r.overdue(context.Background(), time.Now().Add(4*24*time.Hour))
	open, _ := r.anomalies.List(func(string) bool { return true })
	if len(open) != 1 || open[0].Kind != anomaly.Overdue || open[0].Count != 4 {
		t.Fatalf("got %+v, want one note about four days without a run", open)
	}
}

func TestANewFindingIsHandedToTheNextWakeUpOnce(t *testing.T) {
	r, left, _ := syncedPair(t)
	emptyOut(t, left, 30)
	held(t, r)

	found := r.drainTold()
	if len(found) != 1 || found[0].Job != "test" || found[0].Kind != "delete" || !found[0].Held {
		t.Fatalf("the wake-up would hear %+v, want the one held job", found)
	}
	// Confirming the same finding is no news.
	held(t, r)
	if again := r.drainTold(); len(again) != 0 {
		t.Errorf("the same finding would be told twice: %+v", again)
	}
}

func TestAFindingMadeBetweenWakeUpsReachesTheNextOne(t *testing.T) {
	r, left, _ := syncedPair(t)
	emptyOut(t, left, 30)
	held(t, r)

	due := r.RunDue(context.Background())
	if len(due.Found) != 1 || due.Found[0].Job != "test" || !due.Found[0].Held {
		t.Fatalf("the wake-up heard %+v, want the job held before it", due.Found)
	}
	if again := r.RunDue(context.Background()); len(again.Found) != 0 {
		t.Errorf("the next wake-up heard it again: %+v", again.Found)
	}
}

func TestAFindingAnsweredBeforeTheWakeUpIsNotTold(t *testing.T) {
	r, left, _ := syncedPair(t)
	emptyOut(t, left, 30)
	f := held(t, r)
	if _, err := r.TakeBack(context.Background(), f.ID); err != nil {
		t.Fatalf("take back: %v", err)
	}

	if found := r.drainTold(); len(found) != 0 {
		t.Errorf("the wake-up would hear of a job nobody holds any more: %+v", found)
	}
}

func TestAnomaliesSwitchedOffMakeNoNotesWhileABrakeStillHolds(t *testing.T) {
	r, left, right := syncedPair(t)
	cfg := *r.config()
	cfg.Anomalies.Off = true
	r.Reload(&cfg)

	hidden := right + "-away"
	if err := os.Rename(right, hidden); err != nil {
		t.Fatalf("rename: %v", err)
	}
	write(t, right, "in the way")
	for i := range job.DefaultFailingAfter {
		if _, err := r.Run(context.Background(), "test"); err == nil {
			t.Fatalf("run %d succeeded against a side that is a file", i+1)
		}
	}
	if open, _ := r.Findings(context.Background()); len(open) != 0 {
		t.Fatalf("got %+v, want no note while anomalies are off", open)
	}
	if err := os.Remove(right); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := os.Rename(hidden, right); err != nil {
		t.Fatalf("rename: %v", err)
	}

	emptyOut(t, left, 30)
	f := held(t, r)
	if f.Kind != anomaly.Delete {
		t.Errorf("the brake held for %s, want delete", f.Kind)
	}
}

func TestANoteMadeBeforeTheSwitchIsHiddenUntilItIsOnAgain(t *testing.T) {
	r, _, _ := syncedPair(t)
	cfg := *r.config()
	cfg.Jobs = []job.Job{cfg.Jobs[0]}
	cfg.Jobs[0].Schedule = "@hourly"
	r.Reload(&cfg)
	r.overdue(context.Background(), time.Now().Add(4*24*time.Hour))

	off := cfg
	off.Anomalies.Off = true
	r.Reload(&off)
	if open, closed := r.Findings(context.Background()); len(open) != 0 || len(closed) != 0 {
		t.Fatalf("got %+v and %+v, want nothing listed while anomalies are off", open, closed)
	}
	r.Reload(&cfg)
	if open, _ := r.anomalies.List(func(string) bool { return true }); len(open) != 1 || open[0].Kind != anomaly.Overdue {
		t.Errorf("got %+v, want the overdue note back", open)
	}
}

// learned records enough quiet successful runs of the test job for its
// habits to count as learned: none of them deletes anything.
func learned(t *testing.T, r *Runner) {
	t.Helper()
	start := time.Now().Add(-48 * time.Hour)
	for i := range anomaly.LearnAfter {
		at := start.Add(time.Duration(i) * time.Hour)
		if err := r.hist.Record(context.Background(), history.Run{Job: "test", Started: at, Finished: at.Add(time.Minute), Copied: 3}, nil); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
}

func unusualRun(trashed int) history.Run {
	now := time.Now()
	return history.Run{Job: "test", Started: now, Finished: now.Add(time.Minute), Copied: 3, Trashed: trashed}
}

func TestARunFarOutsideTheLearnedRangeMakesANoteThatTheNextUsualRunCloses(t *testing.T) {
	r, _, _ := syncedPair(t)
	learned(t, r)

	r.review(context.Background(), unusualRun(412))
	open, _ := r.Findings(context.Background())
	if len(open) != 1 || open[0].Kind != anomaly.Unusual || open[0].Held {
		t.Fatalf("got %+v, want one note about an unusual run that holds nothing", open)
	}
	if fig := open[0].Figures; len(fig) != 1 || fig[0].Figure != anomaly.Deleted || fig[0].Value != 412 {
		t.Errorf("the note says %+v, want the 412 deletions", fig)
	}

	r.review(context.Background(), unusualRun(0))
	if open, _ := r.Findings(context.Background()); len(open) != 0 {
		t.Errorf("the note outlived a usual run: %+v", open)
	}
}

func TestAJobStillLearningMakesNoUnusualNote(t *testing.T) {
	r, _, _ := syncedPair(t)
	r.review(context.Background(), unusualRun(412))
	if open, _ := r.Findings(context.Background()); len(open) != 0 {
		t.Errorf("a job with one run behind it made a note: %+v", open)
	}
}

func TestUnusualRunsStayQuietWhenSwitchedOff(t *testing.T) {
	no := false
	for name, a := range map[string]job.Anomalies{"notes off": {Off: true}, "unusual off": {Unusual: &no}} {
		t.Run(name, func(t *testing.T) {
			r, _, _ := syncedPair(t)
			cfg := *r.config()
			cfg.Anomalies = a
			r.Reload(&cfg)
			learned(t, r)
			r.review(context.Background(), unusualRun(412))
			if r.anomalies.Has("test", anomaly.Unusual) {
				t.Error("an unusual run made a note while they were switched off")
			}
		})
	}
}

func TestLearningIsListedPerJob(t *testing.T) {
	r, _, _ := syncedPair(t)
	got := r.Learning(context.Background())
	if len(got) != 1 || got[0].Job != "test" || got[0].Runs != 1 || got[0].Learned() {
		t.Fatalf("after the first run the job lists as %+v, want one run learned", got)
	}
	learned(t, r)
	got = r.Learning(context.Background())
	if got[0].Runs != anomaly.LearnAfter+1 || !got[0].Learned() || len(got[0].Usual) != 3 {
		t.Errorf("after %d more runs the job lists as %+v", anomaly.LearnAfter, got[0])
	}
}

func TestTheRunBeingJudgedDoesNotCountTowardsLearning(t *testing.T) {
	r, _, _ := syncedPair(t)
	// With the first run of syncedPair, one short of learned.
	start := time.Now().Add(-48 * time.Hour)
	for i := range anomaly.LearnAfter - 2 {
		at := start.Add(time.Duration(i) * time.Hour)
		if err := r.hist.Record(context.Background(), history.Run{Job: "test", Started: at, Finished: at.Add(time.Minute)}, nil); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	rec := unusualRun(412)
	if err := r.hist.Record(context.Background(), rec, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
	r.review(context.Background(), rec)
	if r.anomalies.Has("test", anomaly.Unusual) {
		t.Error("a run was judged by a range it helped learn")
	}
}
