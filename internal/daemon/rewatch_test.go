package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/watch"
)

// folders is a watched job x between two plain folders, which the test makes
// or takes away as it goes.
type folders struct {
	r           *Runner
	log         *heard
	left, right string
}

func folderJob(t *testing.T) *folders {
	t.Helper()
	dir := t.TempDir()
	f := &folders{log: &heard{}, left: filepath.Join(dir, "left"), right: filepath.Join(dir, "right")}
	body := fmt.Sprintf(`{"jobs":[{"name":"x","schedule":"0 3 1 1 *","watch":true,"watchSettle":"100ms","quietPeriod":"0s","left":%q,"right":%q,"state":%q}]}`,
		filepath.ToSlash(f.left), filepath.ToSlash(f.right), filepath.ToSlash(filepath.Join(dir, "x.db")))
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
	f.r = New(cfg, hist, f.log.log)
	return f
}

// watch starts x's watcher the way a fresh schedule does and stops it, and any
// run it started, when the test ends.
func (f *folders) watch(t *testing.T, now time.Time) context.Context {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		stopped, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		f.r.StopAll(stopped)
	})
	j, _ := f.r.config().Find("x")
	f.r.startWatcher(ctx, ctx, j, nil, now)
	return ctx
}

func mkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
}

// arrives writes a file into one folder and waits for a run to carry it into
// the other, which only a watcher on the first folder can start.
func arrives(t *testing.T, from, to string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(from, "new.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(to, "new.txt")); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("a file written into %s never started a run", from)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func (h *heard) count(part string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, l := range h.lines {
		if strings.Contains(l, part) {
			n++
		}
	}
	return n
}

func TestTheOtherFolderIsWatchedWhileOneIsNotThereYet(t *testing.T) {
	f := folderJob(t)
	mkdir(t, f.left)
	f.watch(t, time.Now())

	arrives(t, f.left, f.right)
}

func TestAFolderThatTurnsUpLaterIsWatchedFromTheNextMinute(t *testing.T) {
	f := folderJob(t)
	mkdir(t, f.left)
	now := time.Now()
	ctx := f.watch(t, now)

	mkdir(t, f.right)
	f.r.rewatch(ctx, ctx, now.Add(time.Minute))
	if !f.log.said("is there now, watching it too") {
		t.Errorf("nothing says the folder is watched now: %q", f.log.lines)
	}
	arrives(t, f.right, f.left)
}

func TestAJobWithNeitherFolderThereYetIsWatchedOnceTheyAre(t *testing.T) {
	f := folderJob(t)
	now := time.Now()
	ctx := f.watch(t, now)

	mkdir(t, f.left)
	mkdir(t, f.right)
	f.r.rewatch(ctx, ctx, now.Add(time.Minute))
	arrives(t, f.left, f.right)
}

func TestAFolderThatStaysAwayIsLoggedOnce(t *testing.T) {
	f := folderJob(t)
	mkdir(t, f.left)
	now := time.Now()
	ctx := f.watch(t, now)

	for i := 1; i <= 3; i++ {
		f.r.rewatch(ctx, ctx, now.Add(time.Duration(i)*time.Minute))
	}
	if n := f.log.count("is not there"); n != 1 {
		t.Errorf("the missing folder was logged %d times, want once: %q", n, f.log.lines)
	}
	if n := f.log.count("watching 1 folder(s)"); n != 1 {
		t.Errorf("the folder that is there was watched %d times, want once: %q", n, f.log.lines)
	}
}

func TestAFolderStillAwayIsNotLoggedAgainWhenTheOtherTurnsUp(t *testing.T) {
	f := folderJob(t)
	now := time.Now()
	ctx := f.watch(t, now)

	mkdir(t, f.right)
	f.r.rewatch(ctx, ctx, now.Add(time.Minute))
	if n := f.log.count(filepath.ToSlash(f.left) + " is not there"); n != 1 {
		t.Errorf("the folder still missing was logged %d times, want once: %q", n, f.log.lines)
	}
	arrives(t, f.right, f.left)
}

// A watch ends with the folder it was on, so a folder taken away and made
// again needs a new one.
func TestAFolderThatWentAwayIsWatchedAgainOnceItIsBack(t *testing.T) {
	f := folderJob(t)
	mkdir(t, f.left)
	mkdir(t, f.right)
	now := time.Now()
	ctx := f.watch(t, now)

	if err := os.RemoveAll(f.right); err != nil {
		t.Fatalf("remove: %v", err)
	}
	// Windows removes a folder somebody still has open only once they let go.
	deadline := time.Now().Add(10 * time.Second)
	for _, err := os.Stat(f.right); !errors.Is(err, os.ErrNotExist); _, err = os.Stat(f.right) {
		if time.Now().After(deadline) {
			t.Fatalf("the folder is still there: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	f.r.rewatch(ctx, ctx, now.Add(time.Minute))
	if !f.log.said("is not there") {
		t.Errorf("nothing says the folder went away: %q", f.log.lines)
	}

	mkdir(t, f.right)
	f.r.rewatch(ctx, ctx, now.Add(2*time.Minute))
	arrives(t, f.right, f.left)
}

// failingWatch makes watch.New fail until told otherwise, and counts the
// tries.
type failingWatch struct {
	tries int
	fail  bool
}

func (w *failingWatch) install(t *testing.T) {
	before := newWatcher
	t.Cleanup(func() { newWatcher = before })
	newWatcher = func(opt watch.Options, onEvent func()) (*watch.Watcher, error) {
		w.tries++
		if w.fail {
			return nil, errors.New("too many watches open")
		}
		return before(opt, onEvent)
	}
}

func TestAWatcherThatWillNotStartIsTriedLessOftenAndLoggedOnce(t *testing.T) {
	f := folderJob(t)
	mkdir(t, f.left)
	mkdir(t, f.right)
	w := &failingWatch{fail: true}
	w.install(t)
	now := time.Now()
	ctx := f.watch(t, now)

	for _, c := range []struct {
		after time.Duration
		tries int
	}{
		{30 * time.Second, 1},
		{61 * time.Second, 2},
		{2 * time.Minute, 2},
		{3*time.Minute + 2*time.Second, 3},
		{6 * time.Minute, 3},
		{7*time.Minute + 3*time.Second, 4},
	} {
		f.r.rewatch(ctx, ctx, now.Add(c.after))
		if w.tries != c.tries {
			t.Fatalf("after %s the watcher was tried %d times, want %d", c.after, w.tries, c.tries)
		}
	}
	if n := f.log.count("could not start watching"); n != 1 {
		t.Errorf("the failure was logged %d times, want once: %q", n, f.log.lines)
	}

	w.fail = false
	f.r.rewatch(ctx, ctx, now.Add(time.Hour))
	if !f.log.said("x: watching 2 folder(s) across 2 local side(s)") {
		t.Errorf("nothing says the watcher started in the end: %q", f.log.lines)
	}
	arrives(t, f.left, f.right)
}
