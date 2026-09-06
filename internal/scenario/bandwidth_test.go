package scenario

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// The bandwidth limit is the one setting in this program that can be accepted,
// stored, shown back and completely ignored.
//
// rclone's token bucket only exists once accounting.Start has been called, and
// its own binary makes that call from its flag parser, which is easy to mistake
// for something that happens by itself. Without it a limit is set on a bucket
// nobody made, every transfer runs at full speed, and nothing anywhere says so.
// The only way to know the difference is to move a known number of bytes and
// look at the clock.

const (
	// Small enough to keep the test quick, large enough that the limit below
	// dominates the time rather than the filesystem does.
	payload = 512 * 1024
	limit   = "256k"
	// What the limit implies for that payload, less a generous margin. rclone
	// fills its bucket before the first read, so the first burst is free and
	// the measured time is always somewhat under the arithmetic.
	atLeast = 900 * time.Millisecond
)

func TestTheBandwidthLimitActuallyLimits(t *testing.T) {
	unlimited := timeOneCopy(t, "")
	limited := timeOneCopy(t, limit)

	if limited < atLeast {
		t.Errorf("copying %d bytes under a %s limit took %v, which is faster than that limit allows: "+
			"the limit is being accepted and ignored", payload, limit, limited)
	}
	// And the comparison, which is what tells a slow machine apart from a limit
	// that does nothing. Without the bucket both runs take the same time.
	if limited < unlimited*2 {
		t.Errorf("limited %v against unlimited %v: the limit made no measurable difference", limited, unlimited)
	}
	t.Logf("unlimited %v, limited to %s %v", unlimited, limit, limited)
}

// timeOneCopy moves one file of a known size and returns how long it took.
func timeOneCopy(t *testing.T, bwLimit string) time.Duration {
	t.Helper()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	// Incompressible on purpose. A backend or filesystem that compresses in
	// flight would move fewer bytes than the test thinks it is measuring.
	body := make([]byte, payload)
	for i := range body {
		body[i] = byte(i * 7919 % 251)
	}
	if err := os.WriteFile(filepath.Join(left, "payload.bin"), body, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	// A context of its own for each measurement, because the limit lives in the
	// configuration the context carries and the two runs must not share one.
	ctx := context.Background()
	ctx, _ = rclonefs.AddConfig(ctx)
	if err := engine.StartAccounting(ctx, bwLimit); err != nil {
		t.Fatalf("start accounting: %v", err)
	}

	leftFs, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()

	opt := engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Transfers: 1}}
	started := time.Now()
	_, res, err := engine.Once(ctx, apply.Ends{Left: leftFs, Right: rightFs}, db, opt)
	took := time.Since(started)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Copied != 1 {
		t.Fatalf("expected one file to cross, %d did", res.Copied)
	}
	return took
}
