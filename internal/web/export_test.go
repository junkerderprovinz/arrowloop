package web

import (
	"encoding/json"
	"testing"
	"time"
)

// ShortenMoveWait hands the fortress phrase to the instances that were away
// every d instead of every minute.
func ShortenMoveWait(t testing.TB, d time.Duration) {
	was := moveWait
	moveWait = d
	t.Cleanup(func() { moveWait = was })
}

// ShortenTrashWait lets a test reach the deadline on a side's trash listing
// without waiting the full minute.
func ShortenTrashWait(t testing.TB, d time.Duration) {
	was := trashWait
	trashWait = d
	t.Cleanup(func() { trashWait = was })
}

// InFortress reports whether s has its fortress open.
func (s *Server) InFortress() bool { return s.fortressNow() != nil }

// BackdateMove restarts the pairing as if its move into the fortress had
// started ago before now.
func (s *Server) BackdateMove(t testing.TB, ago time.Duration) {
	t.Helper()
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	s.closeGroupLocked()
	store := s.Pairing.MoveStore()
	raw, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["retired"], err = json.Marshal(time.Now().Add(-ago)); err != nil {
		t.Fatal(err)
	}
	if raw, err = json.Marshal(doc); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(raw); err != nil {
		t.Fatal(err)
	}
	s.openGroupLocked()
}
