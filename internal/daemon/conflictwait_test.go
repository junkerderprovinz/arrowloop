package daemon

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/webdav"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// silentServer accepts connections and never answers on them, like a server
// whose backend has gone away behind a proxy, until hangUp closes it all. Each
// connection it takes is told on arrived.
func silentServer(t *testing.T) (addr string, arrived <-chan struct{}, hangUp func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	held := make(chan net.Conn, 64)
	told := make(chan struct{}, 64)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				close(held)
				return
			}
			held <- c
			told <- struct{}{}
		}
	}()
	return ln.Addr().String(), told, func() {
		ln.Close()
		for c := range held {
			c.Close()
		}
	}
}

// heldDeadline stands in for the wait on each job's read, so a read runs out
// of time when the test lets go instead of when a clock says, and every read
// that ends is told on ended.
type heldDeadline struct {
	release chan struct{}
	ended   chan struct{}
}

func (h *heldDeadline) bound(ctx context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancelCause(ctx)
	go func() {
		select {
		case <-h.release:
			cancel(context.DeadlineExceeded)
		case <-ctx.Done():
		}
	}()
	return ctx, func() {
		cancel(context.Canceled)
		h.ended <- struct{}{}
	}
}

// await fails the test when want signals have not come within a generous
// bound, which only a hang reaches.
func await(t *testing.T, ch <-chan struct{}, want int, what string) {
	t.Helper()
	for i := 0; i < want; i++ {
		select {
		case <-ch:
		case <-time.After(30 * time.Second):
			t.Fatalf("%s: %d of %d", what, i, want)
		}
	}
}

func TestJobsOnASilentServerGiveUpTogetherAndLeaveTheOthersRead(t *testing.T) {
	deadline := &heldDeadline{release: make(chan struct{}), ended: make(chan struct{}, 8)}
	was := conflictDeadline
	conflictDeadline = deadline.bound
	t.Cleanup(func() { conflictDeadline = was })
	addr, arrived, hangUp := silentServer(t)
	defer hangUp()

	root := t.TempDir()
	dir := func(name string) string {
		d := filepath.Join(root, name)
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		return d
	}
	silent := ":webdav,url='http://" + addr + "/':x"
	cfg := &job.Config{ParallelJobs: 1}
	for _, name := range []string{"one", "two", "three", "four"} {
		cfg.Jobs = append(cfg.Jobs, job.Job{Name: name, Left: dir(name), Right: silent, State: filepath.Join(root, name+".db")})
	}
	cfg.Jobs = append(cfg.Jobs, job.Job{Name: "home", Left: dir("a"), Right: dir("b"), State: filepath.Join(root, "home.db")})

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	t.Cleanup(func() { hist.Close() })
	r := New(cfg, hist, func(string, ...any) {})

	got := make(chan []Unread, 1)
	go func() {
		_, unread := r.Conflicts(context.Background(), "", false)
		got <- unread
	}()

	// A silent job cannot end before the deadline is let go, so the one read
	// that ends first is home's, and four connections held at once mean the
	// silent jobs wait side by side rather than one after another.
	await(t, deadline.ended, 1, "the job on two local folders was never read")
	await(t, arrived, 4, "the silent jobs did not all wait at once")
	close(deadline.release)

	select {
	case unread := <-got:
		if len(unread) != 4 {
			t.Fatalf("expected the four silent jobs unread, got %+v", unread)
		}
		for _, u := range unread {
			if u.Job == "home" {
				t.Errorf("the job on two local folders went unread: %v", u.Err)
			}
			if !strings.Contains(u.Err.Error(), "no answer within") {
				t.Errorf("%s went unread for another reason: %v", u.Job, u.Err)
			}
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the conflicts are still waiting on a side that never answers")
	}
}
