package watch

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

// kqueue gives no order between the Remove of a folder and the Create of the
// one that replaced it under the same name.
func TestAReplacedFolderIsWatchedWhenItsCreateComesFirst(t *testing.T) {
	root := t.TempDir()
	report := filepath.Join(root, "Report")
	if err := os.Mkdir(report, 0o755); err != nil {
		t.Fatal(err)
	}

	events := make(chan fsnotify.Event, 2)
	added := make(chan string, 8)
	w := &Watcher{
		opt: Options{Roots: []string{root}, Settle: time.Hour, Cooldown: time.Second, Log: t.Logf},
		src: &source{
			events: events,
			errors: make(chan error),
			add:    func(dir string) error { added <- dir; return nil },
			remove: func(string) error { return nil },
			close:  func() error { return nil },
		},
		onEvent: func() {},
		watched: map[string]bool{},
	}
	if err := w.addTree(root); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		<-added
	}

	if err := os.RemoveAll(report); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(report, 0o755); err != nil {
		t.Fatal(err)
	}
	events <- fsnotify.Event{Name: report, Op: fsnotify.Create}
	events <- fsnotify.Event{Name: report, Op: fsnotify.Remove}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)

	select {
	case dir := <-added:
		if dir != report {
			t.Fatalf("watched %s, want %s", dir, report)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the folder that replaced Report was never watched")
	}
}
