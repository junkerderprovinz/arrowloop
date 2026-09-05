package watch_test

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/junkerderprovinz/reeveroll/internal/filter"
	"github.com/junkerderprovinz/reeveroll/internal/scan"
	"github.com/junkerderprovinz/reeveroll/internal/watch"
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
	t.Cleanup(func() { _ = w })
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

// TestManyFilesAreOneChange is the reason the watcher collects rather than
// forwards. Copying a folder in produces one event per file, and a run per
// event would be a thousand runs for one action.
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

// TestANewFolderIsWatchedToo covers the gap that makes a naive watcher useless.
//
// The kernel reports on a directory's own entries, not on its whole subtree. A
// folder created and then filled would go completely unnoticed unless the
// watcher adds the new directory as it appears.
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

// TestTheToolsOwnFolderIsIgnored stops the engine answering itself.
//
// A deletion is a move into the reserved trash, which is inside the tree. A
// watcher that reported it would wake the job that just made it, every time.
func TestTheToolsOwnFolderIsIgnored(t *testing.T) {
	root, fired := harness(t, watch.Options{})

	write(t, filepath.Join(root, filepath.FromSlash(scan.TrashDir), "run", "gone.txt"), "trashed")
	time.Sleep(400 * time.Millisecond)
	if n := fired.Load(); n != 0 {
		t.Fatalf("writing into the tool's own trash woke the job %d times", n)
	}

	// And a real file still does wake it, so the test above is not passing
	// because the watcher is simply asleep.
	write(t, filepath.Join(root, "real.txt"), "user data")
	waitFor(t, fired, 1, "a real file after the trash")
}

// TestExcludedPathsDoNotWake keeps a folder of temporary files from waking a
// job that was told to ignore every one of them.
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

// TestMuteStopsTheEngineAnsweringItself covers the loop this design would
// otherwise have. A run writes files, the watcher sees them, the job runs
// again. The second run finds nothing to do, so it terminates either way, but a
// job that reacts to every one of its own writes never sits still.
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

	// Once the cooldown is over it has to start noticing again, or muting once
	// would mean muting forever.
	time.Sleep(600 * time.Millisecond)
	write(t, filepath.Join(root, "written-by-a-person.txt"), "x")
	waitFor(t, fired, 1, "after the cooldown expired")
}

// TestNothingLocalIsRefused states the limit out loud. Only a local side can be
// watched, and a job told to watch a pair of remotes has to be told that rather
// than sitting there watching nothing.
func TestNothingLocalIsRefused(t *testing.T) {
	_, err := watch.New(watch.Options{Roots: nil}, func() {})
	if err == nil {
		t.Fatal("a watcher over no local side was created anyway")
	}
}
