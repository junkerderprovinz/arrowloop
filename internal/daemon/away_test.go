package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

func TestAJobWhoseFolderIsGoneWaitsWithoutAFailedRun(t *testing.T) {
	r, left, right := syncedPair(t)
	away := right + "-away"
	if err := os.Rename(right, away); err != nil {
		t.Fatalf("rename: %v", err)
	}

	if _, err := r.RunAutomatically(context.Background(), "test"); !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("a turn without the right side ended with %v, want it waiting for the side", err)
	}
	if runs := runsOf(t, r, "test"); len(runs) != 1 || runs[0].Failed() {
		t.Errorf("the log holds %+v, want only the first run", runs)
	}
	if _, waits := r.WaitingFor("test"); !waits {
		t.Error("the job does not say it waits for its side")
	}
	if open, _ := r.Findings(context.Background()); len(open) != 0 {
		t.Errorf("a side that is away holds the job as if it were emptied: %+v", open)
	}

	// The next turn finds it still away.
	if _, err := r.RunAutomatically(context.Background(), "test"); !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("the second turn without the side ended with %v", err)
	}
	if n := count(t, left); n != 40 {
		t.Errorf("the left side holds %d files, want all 40", n)
	}
}

func TestAJobWhoseFolderIsBackRunsOnceOnItsOwn(t *testing.T) {
	r, _, right := syncedPair(t)
	away := right + "-away"
	if err := os.Rename(right, away); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := r.RunAutomatically(context.Background(), "test"); !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("a turn without the right side ended with %v", err)
	}

	r.catchUp(context.Background())
	if n := len(runsOf(t, r, "test")); n != 1 {
		t.Fatalf("the job ran %d times while its side was still away", n-1)
	}

	if err := os.Rename(away, right); err != nil {
		t.Fatalf("rename: %v", err)
	}
	r.catchUp(context.Background())
	runs := runsOf(t, r, "test")
	if len(runs) != 2 || runs[0].Failed() {
		t.Fatalf("the log holds %+v once the side was back, want one more good run", runs)
	}
	if _, waits := r.WaitingFor("test"); waits {
		t.Error("the job still waits for a side that is back")
	}
	r.catchUp(context.Background())
	if n := len(runsOf(t, r, "test")); n != 2 {
		t.Errorf("the next minute ran it again, %d runs", n)
	}
}

// A drive letter that is not there is the drive that is unplugged, and a
// network drive that dropped looks the same.
func TestAJobOnADriveLetterThatIsNotThereWaitsForIt(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive letters are a Windows thing")
	}
	letter := freeLetter(t)
	r, _, _ := newRunner(t)
	cfg := edited(r.config())
	cfg.Jobs[0].Right = letter + `:\opencloud`
	r.Reload(cfg)

	if _, err := r.RunAutomatically(context.Background(), "test"); !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("a turn onto %s: ended with %v, want it waiting for the drive", letter, err)
	}
	if n := len(runsOf(t, r, "test")); n != 0 {
		t.Errorf("the log holds %d runs for a drive that is not there", n)
	}
	if _, waits := r.WaitingFor("test"); !waits {
		t.Error("the job does not say it waits for its drive")
	}
}

func freeLetter(t *testing.T) string {
	t.Helper()
	for l := 'Z'; l >= 'D'; l-- {
		if _, err := os.Stat(string(l) + `:\`); err != nil {
			return string(l)
		}
	}
	t.Skip("every drive letter is taken")
	return ""
}

// The side is pulled away while the copies are going. The run stops instead of
// trying every file, nothing is recorded as failed, and once the side is back
// one run finishes the job with nothing lost on either side.
func TestARunWhoseSideGoesAwayMidwayStopsAndCarriesOnOnceItIsBack(t *testing.T) {
	r, left, right := newRunner(t)
	cfg := edited(r.config())
	// One file at a time leaves moments with nothing open, which Windows
	// needs before it renames a folder.
	cfg.Jobs[0].Transfers = 1
	cfg.Jobs[0].QuietPeriod = "0s"
	r.Reload(cfg)
	away := left + "-away"

	events, stop := r.Subscribe()
	defer stop()
	done := make(chan error, 1)
	go func() {
		_, err := r.RunAutomatically(context.Background(), "test")
		done <- err
	}()

	pulled := false
	var err error
wait:
	for {
		select {
		case err = <-done:
			break wait
		case ev := <-events:
			if pulled || ev.Phase != "progress" || ev.Kind != "copy" || ev.Done < 20 {
				continue
			}
			for !pulled {
				if os.Rename(left, away) == nil {
					pulled = true
				}
			}
		}
	}
	if !pulled {
		t.Fatalf("the run finished before its side could be pulled away: %v", err)
	}
	if !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("the run ended with %v, want it waiting for its side", err)
	}
	if n := len(runsOf(t, r, "test")); n != 0 {
		t.Errorf("the log holds %d runs for a run whose side went away", n)
	}
	copied := count(t, right)
	if copied == 0 || copied >= files {
		t.Fatalf("the right side holds %d of %d files, want the run stopped partway", copied, files)
	}
	if _, waits := r.WaitingFor("test"); !waits {
		t.Error("the job does not say it waits for its side")
	}

	if err := os.Rename(away, left); err != nil {
		t.Fatalf("rename: %v", err)
	}
	quicker := edited(r.config())
	quicker.Jobs[0].Transfers = 0
	r.Reload(quicker)
	r.catchUp(context.Background())
	runs := runsOf(t, r, "test")
	if len(runs) != 1 || runs[0].Failed() || runs[0].Trashed != 0 {
		t.Fatalf("the log holds %+v once the side was back, want one good run that deleted nothing", runs)
	}
	if l, rt := count(t, left), count(t, right); l != files || rt != files {
		t.Errorf("the sides hold %d and %d files, want %d on each", l, rt, files)
	}
}

// A side that does not exist yet on a drive that is there is the target of a
// new job, which the first run creates.
func TestANewJobStillCreatesItsTarget(t *testing.T) {
	root := t.TempDir()
	left := filepath.Join(root, "left")
	if err := os.MkdirAll(left, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, filepath.Join(left, "datei-01.txt"), "one")
	right := filepath.Join(root, "new", "target")
	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs:         []job.Job{{Name: "test", Left: left, Right: right, State: filepath.Join(root, "state.db"), QuietPeriod: "0s"}},
		ParallelJobs: 1,
	}
	r := New(cfg, hist, func(string, ...any) {})
	if _, err := r.RunAutomatically(context.Background(), "test"); err != nil {
		t.Fatalf("the first run of a new job: %v", err)
	}
	if n := count(t, right); n != 1 {
		t.Errorf("the new target holds %d files, want 1", n)
	}
	if _, waits := r.WaitingFor("test"); waits {
		t.Error("a new job waits for a target it is meant to create")
	}
}

func TestARunStartedByHandWithoutItsFolderWaitsLikeAnAutomaticOne(t *testing.T) {
	r, _, right := syncedPair(t)
	if err := os.Rename(right, right+"-away"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := r.Run(context.Background(), "test"); !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("a run without the right side ended with %v, want it waiting for the side", err)
	}
	if _, waits := r.WaitingFor("test"); !waits {
		t.Error("the job does not say it waits for its side")
	}
	if runs := runsOf(t, r, "test"); len(runs) != 1 {
		t.Errorf("the log holds %d runs, want only the first", len(runs))
	}
}
