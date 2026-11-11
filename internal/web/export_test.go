package web

import (
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
