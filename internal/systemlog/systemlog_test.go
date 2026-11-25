package systemlog

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/rclone/rclone/fs"
	rclonelog "github.com/rclone/rclone/fs/log"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// store keeps what it is given, and can hold the first write until let go,
// as a disk that is slow to answer would.
type store struct {
	mu    sync.Mutex
	lines []history.SystemLine
	hold  chan struct{}
}

func (s *store) AddSystemLog(_ context.Context, lines []history.SystemLine) error {
	if s.hold != nil {
		<-s.hold
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = append(s.lines, lines...)
	return nil
}

func (s *store) got() []history.SystemLine {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]history.SystemLine(nil), s.lines...)
}

func TestANoteReachesTheStore(t *testing.T) {
	s := &store{}
	l := New(s)
	l.Note(Connection, "%s: %v", "photos", "dial tcp 10.0.0.2:22: connection refused")
	l.Close()

	got := s.got()
	if len(got) != 1 || got[0].Source != Connection || got[0].Text != "photos: dial tcp 10.0.0.2:22: connection refused" || got[0].At.IsZero() {
		t.Fatalf("stored %+v, want the one connection error with its time", got)
	}
}

func TestANoteLeavesItsSecretsOut(t *testing.T) {
	s := &store{}
	l := New(s)
	l.Note(Rclone, "%s", "open :sftp,host=nas,pass=SECRET1:/photos: GET https://bob:SECRET2@host/x?access_token=SECRET3: Authorization: Bearer SECRET4")
	l.Close()

	got := s.got()
	if len(got) != 1 {
		t.Fatalf("stored %d lines, want 1", len(got))
	}
	if strings.Contains(got[0].Text, "SECRET") {
		t.Errorf("stored %q, which still holds a secret", got[0].Text)
	}
}

func TestALongErrorIsCut(t *testing.T) {
	s := &store{}
	l := New(s)
	l.Note(Rclone, "%s", strings.Repeat("ü", maxText))
	l.Close()

	got := s.got()
	if len(got) != 1 || len(got[0].Text) > maxText+len("…") || !strings.HasSuffix(got[0].Text, "…") {
		t.Fatalf("stored %d bytes, want at most %d and a mark that it was cut", len(got[0].Text), maxText)
	}
	if !strings.HasPrefix(got[0].Text, "üü") || strings.ContainsRune(got[0].Text, '�') {
		t.Errorf("the cut split a letter: %q", got[0].Text[len(got[0].Text)-8:])
	}
}

// rclone can report the same failure for every file of a large folder, and a
// disk that answers slowly meanwhile must not let the waiting lines grow
// without end.
func TestABurstWaitsInABoundedQueue(t *testing.T) {
	s := &store{hold: make(chan struct{})}
	l := New(s)
	l.Note(Rclone, "first")
	for i := range 3 * history.SystemLogKeep {
		l.Note(Rclone, "Failed to copy file %d", i)
	}
	close(s.hold)
	l.Close()

	got := s.got()
	if len(got) > history.SystemLogKeep+1 {
		t.Fatalf("stored %d lines, want at most %d", len(got), history.SystemLogKeep+1)
	}
	if last := got[len(got)-1].Text; last != fmt.Sprintf("Failed to copy file %d", 3*history.SystemLogKeep-1) {
		t.Errorf("the newest line stored is %q, want the newest one noted", last)
	}
}

func TestTheSameErrorInARowIsCounted(t *testing.T) {
	s := &store{hold: make(chan struct{})}
	l := New(s)
	l.Note(Connection, "first")
	for range 5 {
		l.Note(Connection, "nas: no route to host")
	}
	close(s.hold)
	l.Close()

	got := s.got()
	if len(got) != 2 || got[1].Count != 5 {
		t.Fatalf("stored %+v, want the repeated error once, counted five times", got)
	}
}

func TestNothingIsNotedWithoutALog(t *testing.T) {
	var l *Log
	l.Note(Integration, "fortress: could not join the fortress")
}

func TestRclonesErrorsAreNoted(t *testing.T) {
	s := &store{}
	l := New(s)
	l.CatchRclone()
	t.Cleanup(func() { fs.SetLogger(rclonelog.Handler) })

	fs.Errorf("photos/a.jpg", "Failed to copy: %v", "disk full")
	fs.Logf(nil, "Transferred 3 files")
	slog.New(handler{inner: slog.DiscardHandler, log: l}).Warn("a warning is no error")
	l.Close()

	got := s.got()
	if len(got) != 1 || got[0].Source != Rclone || got[0].Text != "photos/a.jpg: Failed to copy: disk full" {
		t.Fatalf("stored %+v, want rclone's one error with the file it names", got)
	}
}
