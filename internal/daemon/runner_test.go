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

	runs, err := hist.Recent(context.Background(), "photos", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 || runs[0].Copied != 1 || runs[0].Failed() {
		t.Fatalf("the run was not recorded properly: %+v", runs)
	}
}

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

	runs, err := hist.Recent(context.Background(), "broken", history.ShowAll, 10)
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
		}, nil); err != nil {
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
	runs, err := hist.Recent(ctx, "x", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("%d runs left, want 2", len(runs))
	}
	// A keep of zero means for ever, not delete everything.
	if n, err := hist.Prune(ctx, 0, now); err != nil || n != 0 {
		t.Fatalf("a zero retention deleted %d runs (err %v); it must mean keep forever", n, err)
	}
}

// Syncing against whatever now holds the path would destroy data, and failing
// would train the owner to ignore notifications, so the job does not run.
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

	attached(drive)
	r := daemon.New(cfg, hist, nil, nil)
	if _, err := r.Run(t.Context(), "onstick"); err != nil {
		t.Fatalf("the run failed with the drive attached: %v", err)
	}
	if _, err := os.Stat(filepath.Join(drive, "photos", "holiday.jpg")); err != nil {
		t.Fatalf("the file did not reach the drive: %v", err)
	}

	before, err := hist.Recent(t.Context(), "", history.ShowAll, 100)
	if err != nil {
		t.Fatalf("history: %v", err)
	}

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

	after, err := hist.Recent(t.Context(), "", history.ShowAll, 100)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("an unplugged drive left %d extra rows in the history", len(after)-len(before))
	}

	// An empty destination must not read as both files deleted there.
	for _, name := range []string{"holiday.jpg", "second.jpg"} {
		if _, err := os.Stat(filepath.Join(left, name)); err != nil {
			t.Errorf("%s was removed while the drive was unplugged: %v", name, err)
		}
	}

	// Back at a different mount point, which a drive letter cannot survive.
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
	// Only one copy and no deletion: the record survived the move.
	if rec.Trashed != 0 {
		t.Errorf("%d files were deleted after the drive moved", rec.Trashed)
	}
}

// A job saved without its sides is refused with its own error rather than
// handing an empty path to a backend.
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

	runs, err := hist.Recent(t.Context(), "unfinished", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 0 {
		t.Errorf("a job that was refused before it started left %d rows in the history", len(runs))
	}
}

// Serve rebuilds its round on every configuration change, which happens every
// time a job is saved, and the start-up runs must not fire again then.
func TestRunAtStartFiresOnceAndNotOnReload(t *testing.T) {
	cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(
			`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s","runAtStart":true}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := daemon.New(cfg, hist, nil, nil)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()

	served := make(chan error, 1)
	go func() { served <- r.Serve(ctx) }()

	// Wait for the record rather than the file: the file lands before the run
	// finishes and the record after.
	waitFor(t, func() bool {
		runs, err := hist.Recent(context.Background(), "photos", history.ShowAll, 10)
		return err == nil && len(runs) >= 1
	}, "the start-up run never recorded anything")

	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Fatalf("the start-up run recorded a run but did not copy the file: %v", err)
	}
	runs, err := hist.Recent(context.Background(), "photos", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected exactly one run at start, got %d", len(runs))
	}

	r.Reload(cfg)

	// Long enough for a second start-up run to be recorded.
	time.Sleep(2 * time.Second)

	runs, err = hist.Recent(context.Background(), "photos", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("a reload started the job again: %d runs, expected 1", len(runs))
	}

	stop()
	if err := <-served; err != nil {
		t.Fatalf("serve: %v", err)
	}
}

func TestADisabledJobDoesNotRunAtStart(t *testing.T) {
	cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(
			`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s","runAtStart":true,"disabled":true}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")))
	})
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := daemon.New(cfg, hist, nil, nil)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()

	served := make(chan error, 1)
	go func() { served <- r.Serve(ctx) }()

	// Long enough that a start-up run would have happened.
	time.Sleep(2 * time.Second)

	if _, err := os.Stat(filepath.Join(right, "a.txt")); err == nil {
		t.Fatal("a disabled job synced at start")
	}
	runs, err := hist.Recent(context.Background(), "photos", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 0 {
		t.Fatalf("a disabled job recorded %d runs at start", len(runs))
	}

	stop()
	if err := <-served; err != nil {
		t.Fatalf("serve: %v", err)
	}
}

// waitFor polls for a condition for up to ten seconds.
func waitFor(t *testing.T, ok func() bool, complaint string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal(complaint)
}

// Jobs created in the interface get a state path of "state/<name>.db", and
// SQLite does not create a missing folder.
func TestAJobWhoseStateFolderDoesNotExistStillRuns(t *testing.T) {
	var stateDir string
	cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
		stateDir = filepath.Join(dir, "state")
		return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"state/photos.db","quietPeriod":"0s"}]}`,
			jsonPath(left), jsonPath(right))
	})
	if _, err := os.Stat(stateDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the test needs the state folder to be missing, but Stat said: %v", err)
	}

	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := daemon.New(cfg, hist, nil, nil)
	rec, err := r.Run(context.Background(), "photos")
	if err != nil {
		t.Fatalf("a job whose state folder does not exist yet could not run: %v", err)
	}
	if rec.Copied != 1 {
		t.Fatalf("expected one file copied, got %d", rec.Copied)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Fatalf("the file did not arrive: %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, "photos.db")); err != nil {
		t.Fatalf("the state database was not left where the job asked for it: %v", err)
	}
}

// The apply package's tests call discard directly; this checks that the job's
// setting actually reaches it.
func TestATrashlessJobDeletesOutrightAndLeavesNoReservedFolder(t *testing.T) {
	for _, tc := range []struct {
		name      string
		noTrash   string
		wantMeta  bool
		complaint string
	}{
		{"with a trash", "", true, "a job that kept its trash left no reserved folder, so the deletion did not go through the trash at all"},
		{"without one", `,"noTrash":true`, false, "a job configured for no trash created the reserved folder anyway"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
				return fmt.Sprintf(`{"jobs":[{"name":"photos","left":"%s","right":"%s","state":"%s","quietPeriod":"0s"%s}]}`,
					jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "photos.db")), tc.noTrash)
			})

			// Two files, so removing one does not leave an empty side, which
			// trips the brake for an unmounted volume.
			for _, name := range []string{"a.txt", "stays.txt"} {
				if err := os.WriteFile(filepath.Join(left, name), []byte("hello"), 0o644); err != nil {
					t.Fatalf("write: %v", err)
				}
			}

			r := daemon.New(cfg, hist, nil, nil)
			// The first run's record makes the second one a deletion.
			if _, err := r.Run(context.Background(), "photos"); err != nil {
				t.Fatalf("first run: %v", err)
			}
			if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
				t.Fatalf("the file did not arrive: %v", err)
			}

			if err := os.Remove(filepath.Join(left, "a.txt")); err != nil {
				t.Fatalf("remove: %v", err)
			}
			rec, err := r.Run(context.Background(), "photos")
			if err != nil {
				t.Fatalf("second run: %v", err)
			}
			if rec.Trashed != 1 {
				t.Fatalf("expected the deletion to be counted once, got %d", rec.Trashed)
			}
			if _, err := os.Stat(filepath.Join(right, "a.txt")); !os.IsNotExist(err) {
				t.Fatalf("the file is still on the right: %v", err)
			}

			_, err = os.Stat(filepath.Join(right, ".arrowloop"))
			if tc.wantMeta && os.IsNotExist(err) {
				t.Fatal(tc.complaint)
			}
			if !tc.wantMeta && err == nil {
				t.Fatal(tc.complaint)
			}
		})
	}
}

// Both halves are asserted: a missing file alone could mean no run happened,
// and a recorded run alone could mean it copied everything.
func TestAReportOnlyJobPlansOnTheClockAndMovesNothing(t *testing.T) {
	cfg, hist, left, right := fixture(t, func(dir, left, right string) string {
		return fmt.Sprintf(`{"jobs":[{"name":"watchonly","left":"%s","right":"%s","state":"%s","quietPeriod":"0s","reportOnly":true}]}`,
			jsonPath(left), jsonPath(right), jsonPath(filepath.Join(dir, "w.db")))
	})
	if err := os.WriteFile(filepath.Join(left, "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	r := daemon.New(cfg, hist, nil, nil)
	if _, err := r.RunAutomatically(context.Background(), "watchonly"); err != nil {
		t.Fatalf("automatic run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); !os.IsNotExist(err) {
		t.Fatalf("a report-only job copied the file: %v", err)
	}
	runs, err := hist.Recent(context.Background(), "watchonly", history.ShowAll, 10)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(runs) != 1 || runs[0].Failed() {
		t.Fatalf("expected one clean run to be recorded, got %+v", runs)
	}
	if runs[0].Copied != 0 {
		t.Fatalf("a report-only run counted %d copies", runs[0].Copied)
	}

	// Nothing was recorded as done, so the next turn finds the same work.
	if _, err := r.RunAutomatically(context.Background(), "watchonly"); err != nil {
		t.Fatalf("second automatic run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("the second automatic run copied the file")
	}

	// A run started by hand applies.
	if _, err := r.Run(context.Background(), "watchonly"); err != nil {
		t.Fatalf("hand-started run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(right, "a.txt")); err != nil {
		t.Fatalf("a hand-started run on a report-only job did not copy: %v", err)
	}
}
