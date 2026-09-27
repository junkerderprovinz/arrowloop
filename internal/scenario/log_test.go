package scenario

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
)

// logged collects what a run hands a Logger as it goes.
type logged struct {
	mu    sync.Mutex
	lines []apply.Entry
}

func (l *logged) Starting(int)                                 {}
func (l *logged) Did(string, string, string, string, int, int) {}
func (l *logged) Logged(e apply.Entry) {
	l.mu.Lock()
	l.lines = append(l.lines, e)
	l.mu.Unlock()
}

func (j *job) syncLogged(t *testing.T) (apply.Result, []apply.Entry) {
	t.Helper()
	var l logged
	_, res, err := engine.OnceWatched(context.Background(), j.ends, j.db, j.opt, &l)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	return res, l.lines
}

func noteOf(t *testing.T, lines []apply.Entry, kind, path string) string {
	t.Helper()
	for _, e := range lines {
		if e.Kind == kind && e.Path == path {
			return e.Note
		}
	}
	t.Fatalf("no %s line for %s in %+v", kind, path, lines)
	return ""
}

// The log shown while a run goes is built from these lines, and the record
// stored afterwards from Result.Entries, so the two must be the same list.
func TestALoggerHearsEveryLineInTheRecordsOrder(t *testing.T) {
	j := newJob(t, quick())
	for _, name := range []string{"a.txt", "b.txt", "sub/c.txt"} {
		write(t, j.left, name, name)
	}
	write(t, j.right, "same.txt", "equal")
	write(t, j.left, "same.txt", "equal")

	res, lines := j.syncLogged(t)
	if len(lines) != len(res.Entries) {
		t.Fatalf("the logger heard %d lines and the result holds %d", len(lines), len(res.Entries))
	}
	for i := range lines {
		if lines[i] != res.Entries[i] {
			t.Errorf("line %d was heard as %+v and recorded as %+v", i, lines[i], res.Entries[i])
		}
	}
}

// A log line says what happened to the file, not only that something did.
func TestTheLogSaysHowAFileWasChanged(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "report.txt", "first")
	write(t, j.left, "photos/IMG_1.jpg", "a photo")
	write(t, j.left, "old.txt", "going")
	j.sync(t)

	// A newer version, so the copy overwrites what the right side holds.
	later := time.Now().Add(time.Minute)
	write(t, j.left, "report.txt", "second, longer")
	if err := os.Chtimes(filepath.Join(j.left, "report.txt"), later, later); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	if err := os.Rename(filepath.Join(j.left, "photos", "IMG_1.jpg"), filepath.Join(j.left, "photos", "beach.jpg")); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if err := os.Remove(filepath.Join(j.left, "old.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	write(t, j.left, "new.txt", "fresh")

	_, lines := j.syncLogged(t)
	if got := noteOf(t, lines, "copy", "report.txt"); got != apply.NoteReplaced {
		t.Errorf("a copy over an existing file says %q", got)
	}
	if got := noteOf(t, lines, "copy", "new.txt"); got != "" {
		t.Errorf("a copy of a new file says %q", got)
	}
	if got := noteOf(t, lines, "move", "photos/beach.jpg"); got != "photos/IMG_1.jpg" {
		t.Errorf("a rename says %q rather than the name it had", got)
	}
	for _, e := range lines {
		if e.Kind == "move" && e.Path == "photos/beach.jpg" && e.Size != int64(len("a photo")) {
			t.Errorf("a rename logs %d bytes, want the file's %d", e.Size, len("a photo"))
		}
	}
	if got := noteOf(t, lines, "trash", "old.txt"); got != apply.NoteBin {
		t.Errorf("a file put in the bin says %q", got)
	}
}
