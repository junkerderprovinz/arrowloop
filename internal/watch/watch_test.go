package watch_test

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/watch"
)

// harness starts a watcher over a temporary tree and counts what it reports.
func harness(t *testing.T, opt watch.Options) (root string, fired *atomic.Int64) {
	t.Helper()
	root = t.TempDir()
	opt.Roots = []string{root}
	if opt.Settle == 0 {
		opt.Settle = 60 * time.Millisecond
	}
	if opt.Cooldown == 0 {
		opt.Cooldown = 60 * time.Millisecond
	}

	fired = &atomic.Int64{}
	w, err := watch.New(opt, func() { fired.Add(1) })
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		w.Close()
	})
	go w.Run(ctx)
	// Give the watcher a moment to be listening before the test writes.
	time.Sleep(50 * time.Millisecond)
	return root, fired
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func waitFor(t *testing.T, fired *atomic.Int64, want int64, why string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if fired.Load() >= want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s: the watcher reported %d times, wanted %d", why, fired.Load(), want)
}

func TestManyFilesAreOneChange(t *testing.T) {
	root, fired := harness(t, watch.Options{Settle: 150 * time.Millisecond})

	for i := range 40 {
		write(t, filepath.Join(root, "batch", "f"+string(rune('a'+i%26))+string(rune('a'+i/26))+".txt"), "x")
		time.Sleep(2 * time.Millisecond)
	}
	waitFor(t, fired, 1, "a batch of files")

	time.Sleep(400 * time.Millisecond)
	if n := fired.Load(); n > 2 {
		t.Errorf("forty files produced %d reports; the settle window is not collecting them", n)
	}
}

// The kernel reports on a directory's own entries, not on its subtree.
func TestANewFolderIsWatchedToo(t *testing.T) {
	root, fired := harness(t, watch.Options{})

	deep := filepath.Join(root, "new", "deeper")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	waitFor(t, fired, 1, "creating a folder")

	before := fired.Load()
	time.Sleep(200 * time.Millisecond)
	write(t, filepath.Join(deep, "buried.txt"), "hello")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if fired.Load() > before {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("a file written inside a newly created folder was never noticed")
}

// A deletion moves the file into the trash inside the tree, which must not
// wake the job again.
func TestTheToolsOwnFolderIsIgnored(t *testing.T) {
	root, fired := harness(t, watch.Options{})

	write(t, filepath.Join(root, filepath.FromSlash(scan.TrashDir), "run", "gone.txt"), "trashed")
	time.Sleep(400 * time.Millisecond)
	if n := fired.Load(); n != 0 {
		t.Fatalf("writing into the tool's own trash woke the job %d times", n)
	}

	// A real file still wakes it, so the watcher is not simply asleep.
	write(t, filepath.Join(root, "real.txt"), "user data")
	waitFor(t, fired, 1, "a real file after the trash")
}

func TestExcludedPathsDoNotWake(t *testing.T) {
	excl, err := filter.New([]string{"*.tmp", "cache"})
	if err != nil {
		t.Fatalf("filter: %v", err)
	}
	root, fired := harness(t, watch.Options{Exclude: excl})

	write(t, filepath.Join(root, "scratch.tmp"), "noise")
	write(t, filepath.Join(root, "cache", "thing.bin"), "noise")
	time.Sleep(400 * time.Millisecond)
	if n := fired.Load(); n != 0 {
		t.Fatalf("excluded paths woke the job %d times", n)
	}

	write(t, filepath.Join(root, "real.txt"), "user data")
	waitFor(t, fired, 1, "a real file after the excluded ones")
}

func TestMuteStopsTheEngineAnsweringItself(t *testing.T) {
	root := t.TempDir()
	fired := &atomic.Int64{}
	w, err := watch.New(watch.Options{
		Roots:    []string{root},
		Settle:   50 * time.Millisecond,
		Cooldown: 800 * time.Millisecond,
	}, func() { fired.Add(1) })
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	defer w.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)
	time.Sleep(50 * time.Millisecond)

	w.Mute()
	write(t, filepath.Join(root, "written-by-the-engine.txt"), "x")
	time.Sleep(400 * time.Millisecond)
	if n := fired.Load(); n != 0 {
		t.Fatalf("a muted watcher reported %d times", n)
	}

	time.Sleep(600 * time.Millisecond)
	write(t, filepath.Join(root, "written-by-a-person.txt"), "x")
	waitFor(t, fired, 1, "after the cooldown expired")
}

func TestNothingLocalIsRefused(t *testing.T) {
	_, err := watch.New(watch.Options{Roots: nil}, func() {})
	if err == nil {
		t.Fatal("a watcher over no local side was created anyway")
	}
}
