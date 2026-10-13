package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// heard keeps what a runner logged.
type heard struct {
	mu    sync.Mutex
	lines []string
}

func (h *heard) log(format string, args ...any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lines = append(h.lines, fmt.Sprintf(format, args...))
}

func (h *heard) said(part string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, l := range h.lines {
		if strings.Contains(l, part) {
			return true
		}
	}
	return false
}

// onDrive is a job from a local folder onto a marked drive, scheduled once a
// year so a test decides whether a turn was missed by when it says the job
// last worked.
type onDrive struct {
	r     *Runner
	cfg   *job.Config
	drive string
	local string
	log   *heard
}

// driveJob builds the job named x. Its left side is a local folder unless left
// names another, and extra is added to the job's JSON, such as a before
// command.
func driveJob(t *testing.T, left, extra string) *onDrive {
	t.Helper()
	dir := t.TempDir()
	drive := t.TempDir()
	marker, err := volume.Mark(drive, "Backup drive")
	if err != nil {
		t.Fatalf("mark the drive: %v", err)
	}
	local := filepath.Join(dir, "local")
	if err := os.MkdirAll(local, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if left == "" {
		left = filepath.ToSlash(local)
	}
	body := fmt.Sprintf(`{"jobs":[{"name":"x","schedule":"0 3 1 1 *","quietPeriod":"0s","left":%q,"right":"volume:%s/photos","state":%q%s}]}`,
		left, marker.ID, filepath.ToSlash(filepath.Join(dir, "x.db")), extra)
	path := filepath.Join(dir, "arrowloop.json")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	hist, err := history.Open(context.Background(), cfg.History)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })

	before := volume.Candidates
	t.Cleanup(func() { volume.Candidates = before })
	d := &onDrive{cfg: cfg, drive: drive, local: local, log: &heard{}}
	d.plug(false)
	d.r = New(cfg, hist, d.log.log)
	return d
}

func (d *onDrive) plug(in bool) {
	if in {
		volume.Candidates = func() []string { return []string{d.drive} }
		return
	}
	volume.Candidates = func() []string { return nil }
}

// workedAt writes a successful run of x into the log.
func (d *onDrive) workedAt(t *testing.T, at time.Time) {
	t.Helper()
	if err := d.r.hist.Record(context.Background(), history.Run{Job: "x", Started: at, Finished: at}, nil); err != nil {
		t.Fatalf("record: %v", err)
	}
}

// missesItsDrive lets x find its drive missing on its turn, the way the clock
// would.
func (d *onDrive) missesItsDrive(t *testing.T) {
	t.Helper()
	if _, err := d.r.RunAutomatically(context.Background(), "x"); !errors.Is(err, ErrVolumeMissing) {
		t.Fatalf("a turn without the drive ended with %v", err)
	}
	if _, waits := d.r.WaitingFor("x"); !waits {
		t.Fatal("the job does not wait for its drive, so this test proves nothing")
	}
}

const caughtUp = "x: its drive is back, catching up the run it missed"

func TestAJobWhoseDriveComesBackCatchesUpTheTurnItMissedOnce(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	d.missesItsDrive(t)

	d.plug(true)
	d.r.catchUp(context.Background(), time.Now())
	if n := len(runsOf(t, d.r, "x")); n != 2 {
		t.Fatalf("the log holds %d runs after the drive came back, want the old one and the catch-up", n)
	}
	if !d.log.said(caughtUp) {
		t.Errorf("nothing in the log says why the job ran off its schedule: %q", d.log.lines)
	}
	if _, waits := d.r.WaitingFor("x"); waits {
		t.Error("the job still waits for a drive it just ran against")
	}

	d.r.catchUp(context.Background(), time.Now())
	if n := len(runsOf(t, d.r, "x")); n != 2 {
		t.Errorf("the next minute ran it again, %d runs", n)
	}
}

func TestADriveBackWithNothingOwedOnlyEndsTheWait(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().Add(-time.Minute))
	d.missesItsDrive(t)

	d.plug(true)
	d.r.catchUp(context.Background(), time.Now())
	if n := len(runsOf(t, d.r, "x")); n != 1 {
		t.Errorf("a job that owed nothing ran when its drive came back, %d runs", n)
	}
	if _, waits := d.r.WaitingFor("x"); waits {
		t.Error("the job still says it waits for a drive that is plugged in")
	}
}

func TestAJobStillWithoutItsDriveKeepsWaiting(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	d.missesItsDrive(t)

	d.r.catchUp(context.Background(), time.Now())
	if n := len(runsOf(t, d.r, "x")); n != 1 {
		t.Errorf("%d runs without the drive", n)
	}
	if d.log.said(caughtUp) {
		t.Error("the log says the drive is back while it is still missing")
	}
	if _, waits := d.r.WaitingFor("x"); !waits {
		t.Error("the job stopped waiting although its drive is still missing")
	}
}

// Only a turn lost to a missing drive is caught up; any other owed turn is
// the clock's.
func TestAJobNotWaitingForItsDriveIsLeftToItsSchedule(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	d.plug(true)

	d.r.catchUp(context.Background(), time.Now())
	if n := len(runsOf(t, d.r, "x")); n != 1 {
		t.Errorf("an owed job that never missed its drive ran off its schedule, %d runs", n)
	}
}

// A before command may be what attaches the drive, so a drive that turns up
// on its own says nothing about such a job.
func TestAJobWithABeforeCommandIsLeftToItsSchedule(t *testing.T) {
	ran := filepath.Join(t.TempDir(), "before")
	leave := `echo ran > "` + ran + `"`
	if runtime.GOOS == "windows" {
		leave = `> "` + ran + `" echo ran`
	}
	quoted, err := json.Marshal(leave)
	if err != nil {
		t.Fatal(err)
	}
	d := driveJob(t, "", `,"before":`+string(quoted))
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	// Its own turn runs the command, which does not attach the drive.
	d.missesItsDrive(t)
	if err := os.Remove(ran); err != nil {
		t.Fatalf("the before command did not run on the turn: %v", err)
	}

	d.plug(true)
	d.r.catchUp(context.Background(), time.Now())
	if _, err := os.Stat(ran); err == nil {
		t.Error("the before command ran off the job's schedule")
	}
	if n := len(runsOf(t, d.r, "x")); n != 1 {
		t.Errorf("%d runs, want the job left to its schedule", n)
	}
	if _, waits := d.r.WaitingFor("x"); !waits {
		t.Error("the job's wait was touched")
	}
}

func TestAJobAlreadyRunningIsNotCaughtUpAgain(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	d.missesItsDrive(t)
	d.plug(true)

	if !d.r.claim("x", func() {}) {
		t.Fatal("could not hold the job")
	}
	d.r.catchUp(context.Background(), time.Now())
	if d.log.said(caughtUp) {
		t.Error("a job in the middle of a run was caught up as well")
	}

	d.r.release("x")
	d.r.catchUp(context.Background(), time.Now())
	if !d.log.said(caughtUp) {
		t.Error("the job was not caught up once its run was over")
	}
}

func TestAPausedJobIsNotCaughtUp(t *testing.T) {
	d := driveJob(t, "", "")
	d.workedAt(t, time.Now().AddDate(-2, 0, 0))
	d.missesItsDrive(t)
	d.plug(true)

	paused := edited(d.cfg)
	paused.Jobs[0].Disabled = true
	d.r.Reload(paused)

	d.r.catchUp(context.Background(), time.Now())
	if n := len(runsOf(t, d.r, "x")); n != 1 {
		t.Errorf("a paused job ran when its drive came back, %d runs", n)
	}
	if _, waits := d.r.WaitingFor("x"); !waits {
		t.Error("a paused job's wait was touched")
	}
}

// A watcher cannot open a folder on a drive that is not there, so it starts
// without it and has to pick the drive up when it comes back.
func TestAWatchedDriveMissingAtTheStartIsWatchedOnceItIsBack(t *testing.T) {
	d := driveJob(t, "", `,"watch":true,"watchSettle":"100ms"`)
	photos := filepath.Join(d.drive, "photos")
	if err := os.MkdirAll(photos, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		stopped, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		d.r.StopAll(stopped)
	})
	j, _ := d.r.config().Find("x")
	d.r.startWatcher(ctx, ctx, j, nil, time.Now())

	d.plug(true)
	d.r.rewatch(ctx, ctx, time.Now())

	if err := os.WriteFile(filepath.Join(photos, "new.jpg"), []byte("a photo"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(d.local, "new.jpg")); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("a file put on the drive after it came back never started a run: %q", d.log.lines)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestAWatchedJobWhoseOnlyLocalSideIsOnAMissingDriveIsWatchedOnceItIsBack(t *testing.T) {
	d := driveJob(t, ":memory:backup", `,"watch":true,"watchSettle":"100ms"`)
	if err := os.MkdirAll(filepath.Join(d.drive, "photos"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	j, _ := d.r.config().Find("x")
	d.r.startWatcher(ctx, ctx, j, nil, time.Now())
	d.plug(true)
	d.r.rewatch(ctx, ctx, time.Now())
	if !d.log.said("x: watching 1 folder(s) across 1 local side(s)") {
		t.Errorf("the drive was not watched once it came back: %q", d.log.lines)
	}
}

// The watch on a drive that is pulled out ends with it, so a turn that finds
// the drive gone has the watcher started again once it is back.
func TestAWatcherWhoseDriveWasPulledOutStartsAgainWhenItIsBack(t *testing.T) {
	d := driveJob(t, "", `,"watch":true,"watchSettle":"100ms"`)
	if err := os.MkdirAll(filepath.Join(d.drive, "photos"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	d.plug(true)
	j, _ := d.r.config().Find("x")
	d.r.startWatcher(ctx, ctx, j, nil, time.Now())
	d.plug(false)
	d.missesItsDrive(t)

	d.plug(true)
	d.r.rewatch(ctx, ctx, time.Now())
	if !d.log.said("x: its drive is back, watching it too") {
		t.Errorf("the watcher was not started again: %q", d.log.lines)
	}
}
