package verify

import (
	"context"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// MEGA gives a file the moment it was uploaded as its time, so a row for a
// pair there holds two different times for the same content.
func TestAPairOnABackendWithoutTimesIsNotReported(t *testing.T) {
	written := time.Date(2026, 11, 19, 1, 4, 0, 0, time.UTC)
	uploaded := time.Date(2026, 11, 20, 14, 27, 0, 0, time.UTC)
	l := &scan.Entry{Path: "backup.json", Size: 4, Mod: written}
	r := &scan.Entry{Path: "backup.json", Size: 4, Mod: uploaded}
	row := state.Entry{Path: "backup.json", LeftSize: 4, LeftMod: written, RightSize: 4, RightMod: uploaded}

	if found, ok := judge(context.Background(), "backup.json", l, r, row, true, false, 2*time.Second, rclonefs.ModTimeNotSupported); ok {
		t.Errorf("a pair that agrees was reported as %q", found.Code)
	}
}
