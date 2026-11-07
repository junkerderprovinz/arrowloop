package web

import (
	"testing"
	"time"
)

// ShortenTrashWait lets a test reach the deadline on a side's trash listing
// without waiting the full minute.
func ShortenTrashWait(t testing.TB, d time.Duration) {
	was := trashWait
	trashWait = d
	t.Cleanup(func() { trashWait = was })
}
