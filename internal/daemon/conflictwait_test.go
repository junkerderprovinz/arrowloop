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
// whose backend has gone away behind a proxy, until hangUp closes it all.
func silentServer(t *testing.T) (addr string, hangUp func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	held := make(chan net.Conn, 64)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				close(held)
				return
			}
			held <- c
		}
	}()
	return ln.Addr().String(), func() {
		ln.Close()
		for c := range held {
			c.Close()
		}
	}
}

func TestJobsOnASilentServerGiveUpTogetherAndLeaveTheOthersRead(t *testing.T) {
	was := conflictWait
	conflictWait = time.Second
	t.Cleanup(func() { conflictWait = was })
	addr, hangUp := silentServer(t)
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

	type answer struct {
		unread []Unread
		took   time.Duration
	}
	got := make(chan answer, 1)
	go func() {
		started := time.Now()
		_, unread := r.Conflicts(context.Background(), "")
		got <- answer{unread, time.Since(started)}
	}()

	select {
	case a := <-got:
		if len(a.unread) != 4 {
			t.Fatalf("expected the four silent jobs unread, got %+v", a.unread)
		}
		for _, u := range a.unread {
			if u.Job == "home" {
				t.Errorf("the job on two local folders went unread: %v", u.Err)
			}
			if !strings.Contains(u.Err.Error(), "no answer within") {
				t.Errorf("%s went unread for another reason: %v", u.Job, u.Err)
			}
		}
		// Four jobs waited out one after another would take four seconds.
		if a.took > 3*time.Second {
			t.Errorf("the silent jobs were waited out one after another: %s", a.took)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("the conflicts are still waiting on a side that never answers")
	}
}
