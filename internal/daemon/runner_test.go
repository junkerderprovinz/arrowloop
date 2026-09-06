package daemon_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// fixture builds a working configuration over two real temporary folders.
func fixture(t *testing.T, body func(dir, left, right string) string) (*job.Config, *history.DB, string, string) {
	t.Helper()
	dir := t.TempDir()
	left := filepath.Join(dir, "left")
	right := filepath.Join(dir, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	path := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(path, []byte(body(dir, left, right)), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	hist, err := history.Open(context.Background(), cfg.History)
	if err != nil {
		t.Fatalf("open history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	return cfg, hist, left, right
}

func jsonPath(p string) string { return strings.ReplaceAll(p, `\`, `\\`) }

// TestRunSyncsAndRecords is the ordinary case: a job runs, the files move, and
// the run leaves a record.
func TestRunSyncsAndRecords(t *testing.T) {
	cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})

	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := daemon.New(cfg, hist, nil, nil)
	rec, err := r.Run(context.Background(), "photos")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if rec.Copied != 1 {
		t.Fatalf("expected one file copied, got %d", rec.Copied)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Fatalf("the file did not arrive: %v", err)
	}

	runs, err := hist.Recent(context.Background(), "photos", 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 || runs[0].Copied != 1 || runs[0].Failed() {
		t.Fatalf("the run was not recorded properly: %+v", runs)
	}
}

// TestAFailedRunIsStillRecorded is the point of keeping a history at all.
//
// The failure this guards against is not a crash, which is loud, but a job that
// has been failing quietly every quarter of an hour because a path changed. If
// only successes were written down there would be nothing to notice, and the
// backup somebody believes in does not exist.
func TestAFailedRunIsStillRecorded(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		missing := filepath.Join(dir, "not-here", "at", "all")
		return fmt.Sprintf(`{"jobs":[{"name":"broken","left":"%s","right":"%s","state":"%s"}]}`,
			jsonPath(missing), jsonPath(right), jsonPath(filepath.Join(dir, "broken.db")))
	})

	r := daemon.New(cfg, hist, nil, nil)
	if _, err := r.Run(context.Background(), "broken"); err == nil {
		t.Log("the run did not fail, which is fine as long as it was recorded")
	}

	runs, err := hist.Recent(context.Background(), "broken", 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("a failing run left no record at all: %+v", runs)
	}
	if when, ok, err := hist.LastSuccess(context.Background(), "broken"); err != nil {
		t.Fatalf("last success: %v", err)
	} else if ok {
		t.Errorf("a job that never worked reports a last success of %s", when)
	}
}

// TestAJobDoesNotOverlapItself covers the schedule that is faster than the job.
//
// A job set to run every fifteen minutes that takes twenty must not start a
// second copy of itself. Two runs over one pair of folders would race each
// other through the same files and the same state database, and the right
// answer is simply to let this turn go by.
func TestAJobDoesNotOverlapItself(t *testing.T) {
	cfg, hist, left, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"slow","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "slow.db")))
	})
	// Enough files that the first run is still going when the second starts.
	for i := range 400 {
		if err := os.WriteFile(filepath.Join(left, fmt.Sprintf("f%03d.txt", i)), []byte(strings.Repeat("x", 4096)), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	r := daemon.New(cfg, hist, nil, nil)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var refused, ran int

	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := r.Run(context.Background(), "slow")
			mu.Lock()
			defer mu.Unlock()
			switch {
			case errors.Is(err, daemon.ErrAlreadyRunning):
				refused++
			case err == nil:
				ran++
			default:
				t.Errorf("unexpected failure: %v", err)
			}
		}()
	}
	wg.Wait()

	if refused == 0 {
		t.Fatal("six overlapping requests all started; a slow job would pile up on itself")
	}
	if ran == 0 {
		t.Fatal("none of the requests ran at all")
	}
}

// TestAnUnknownJobIsNamed keeps the error useful. A typo in a job name at three
// in the morning should say which name was not found, not fail obscurely.
func TestAnUnknownJobIsNamed(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"real","left":"%s","right":"%s","state":"%s"}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "real.db")))
	})
	r := daemon.New(cfg, hist, nil, nil)
	_, err := r.Run(context.Background(), "typo")
	if err == nil || !strings.Contains(err.Error(), "typo") {
		t.Fatalf("the error does not name the job that was asked for: %v", err)
	}
}

// TestPruneDropsOldRuns keeps the log from growing without bound on a machine
// nobody looks at.
func TestPruneDropsOldRuns(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	hist, err := history.Open(ctx, filepath.Join(dir, "history.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer hist.Close()

	now := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	for i, age := range []time.Duration{time.Hour, 48 * time.Hour, 200 * 24 * time.Hour} {
		if err := hist.Record(ctx, history.Run{
			Job: "x", Started: now.Add(-age), Finished: now.Add(-age).Add(time.Second), Copied: i,
		}); err != nil {
			t.Fatalf("record: %v", err)
		}
	}

	n, err := hist.Prune(ctx, 90*24*time.Hour, now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if n != 1 {
		t.Fatalf("pruned %d runs, want the single one older than 90 days", n)
	}
	runs, err := hist.Recent(ctx, "x", 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("%d runs left, want 2", len(runs))
	}
	// And a keep of zero must mean "forever", not "delete everything".
	if n, err := hist.Prune(ctx, 0, now); err != nil || n != 0 {
		t.Fatalf("a zero retention deleted %d runs (err %v); it must mean keep forever", n, err)
	}
}

// TestAnUnpluggedVolumeIsNotARun covers the whole reason internal/volume
// exists. A job that lives on a removable drive has three possible outcomes
// when the drive is not there, and only one of them is acceptable:
//
//   - it syncs against whatever now holds that path, which destroys data;
//   - it fails, which trains its owner to ignore the notifications;
//   - it does not run, which is the truth.
func TestAnUnpluggedVolumeIsNotARun(t *testing.T) {
	drive := t.TempDir()
	marker, err := volume.Mark(drive, "Backup drive")
	if err != nil {
		t.Fatalf("mark the drive: %v", err)
	}

	cfg, hist, left, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"onstick","left":"%s","right":"volume:%s/photos","state":"%s","quietPeriod":"0s"}]}`,
			jsonPath(left), marker.ID, jsonPath(filepath.Join(dir, "onstick.db")))
	})
	if err := os.WriteFile(filepath.Join(left, "holiday.jpg"), []byte("a photo"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	attached := func(dirs ...string) {
		t.Helper()
		volume.Candidates = func() []string { return dirs }
	}
	realCandidates := volume.Candidates
	t.Cleanup(func() { volume.Candidates = realCandidates })

	// Plugged in: an ordinary run, and the destination is created on the drive
	// under the folder the job names.
	attached(drive)
	r := daemon.New(cfg, hist, nil, nil)
	if _, err := r.Run(t.Context(), "onstick"); err != nil {
		t.Fatalf("the run failed with the drive attached: %v", err)
	}
	if _, err := os.Stat(filepath.Join(drive, "photos", "holiday.jpg")); err != nil {
		t.Fatalf("the file did not reach the drive: %v", err)
	}

	before, err := hist.Recent(t.Context(), "", 100)
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	// The drive is now in somebody's bag.
	attached()
	if err := os.WriteFile(filepath.Join(left, "second.jpg"), []byte("another"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	_, err = r.Run(t.Context(), "onstick")
	if !errors.Is(err, daemon.ErrVolumeMissing) {
		t.Fatalf("an unplugged drive reported %v, which the runner cannot tell apart from a real failure", err)
	}
	if !strings.Contains(err.Error(), "Backup drive") {
		t.Errorf("the message names no drive anybody could recognise: %v", err)
	}

	// Nothing was written down, because nothing happened.
	after, err := hist.Recent(t.Context(), "", 100)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("an unplugged drive left %d extra rows in the history", len(after)-len(before))
	}

	// And the local side is untouched: neither file was treated as deleted on
	// the far side, which is what a naive "the destination is empty" reading
	// would have done.
	for _, name := range []string{"holiday.jpg", "second.jpg"} {
		if _, err := os.Stat(filepath.Join(left, name)); err != nil {
			t.Errorf("%s was removed while the drive was unplugged: %v", name, err)
		}
	}

	// Back in the machine, at a different mount point, which is the case a
	// drive letter cannot survive.
	moved := t.TempDir()
	if err := os.MkdirAll(filepath.Join(moved, ".arrowloop"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(drive, ".arrowloop", "volume.json"))
	if err != nil {
		t.Fatalf("read the marker: %v", err)
	}
	if err := os.Rename(filepath.Join(drive, "photos"), filepath.Join(moved, "photos")); err != nil {
		t.Fatalf("move the contents: %v", err)
	}
	if err := os.WriteFile(filepath.Join(moved, ".arrowloop", "volume.json"), body, 0o644); err != nil {
		t.Fatalf("write the marker: %v", err)
	}
	attached(moved)

	rec, err := r.Run(t.Context(), "onstick")
	if err != nil {
		t.Fatalf("the run failed after the drive came back elsewhere: %v", err)
	}
	if rec.Copied != 1 {
		t.Fatalf("expected the one new file to cross, %d did", rec.Copied)
	}
	if _, err := os.Stat(filepath.Join(moved, "photos", "second.jpg")); err != nil {
		t.Errorf("the new file did not reach the drive at its new mount point: %v", err)
	}
	// The first file is still there and was not copied a second time, which
	// proves the record survived the drive moving.
	if rec.Trashed != 0 {
		t.Errorf("%d files were deleted after the drive moved", rec.Trashed)
	}
}

// TestAHalfWrittenJobIsRefusedByName is the other half of the rule that lets a
// switched-off job be saved without both its sides.
//
// Allowing it to be stored and then handing an empty string to a backend would
// trade one clear refusal for whatever error that backend happens to produce
// about a path that is not a path.
func TestAHalfWrittenJobIsRefusedByName(t *testing.T) {
	cfg, hist, _, _ := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"unfinished","left":"","right":"","state":"%s","disabled":true}]}`,
			jsonPath(filepath.Join(dir, "unfinished.db")))
	})

	r := daemon.New(cfg, hist, nil, nil)
	if _, err := r.Run(t.Context(), "unfinished"); !errors.Is(err, daemon.ErrHalfWritten) {
		t.Fatalf("running a job with no sides reported %v", err)
	}
	if _, err := r.Preview(t.Context(), "unfinished"); !errors.Is(err, daemon.ErrHalfWritten) {
		t.Fatalf("previewing a job with no sides reported %v", err)
	}

	runs, err := hist.Recent(t.Context(), "unfinished", 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 0 {
		t.Errorf("a job that was refused before it started left %d rows in the history", len(runs))
	}
}
