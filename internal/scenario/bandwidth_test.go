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

// Without accounting.Start there is no token bucket and a bandwidth limit is
// silently ignored, so the test moves a known number of bytes and times it.

const (
	// Large enough for the limit rather than the filesystem to dominate.
	payload = 512 * 1024
	limit   = "256k"
	// 512 KiB at 256 KiB/s takes two seconds. rclone starts with an empty
	// bucket that refills with elapsed time, so the bucket is created right
	// before the measurement (see timeOneCopy).
	atLeast = 1500 * time.Millisecond
)

func TestTheBandwidthLimitActuallyLimits(t *testing.T) {
	unlimited := timeOneCopy(t, "off")
	limited := timeOneCopy(t, limit)
	t.Logf("unlimited %v, limited to %s %v", unlimited, limit, limited)

	// A machine that needs most of the floor without any limit cannot tell a
	// working limit from its own slowness.
	if unlimited >= atLeast/2 {
		t.Skipf("moving %d bytes with no limit at all took %v on this machine, too close to the %v floor "+
			"for the measurement to mean anything", payload, unlimited, atLeast)
	}
	if limited < atLeast {
		t.Errorf("copying %d bytes under a %s limit took %v (unlimited: %v), which is faster than that limit "+
			"allows: the limit is being accepted and ignored", payload, limit, limited, unlimited)
	}
}

// timeOneCopy moves one file of a known size and returns how long it took.
// bwLimit is never empty: "off" turns the limit off, while "" would leave it
// as it was.
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
	// Incompressible, so compression in flight cannot shrink the transfer.
	body := make([]byte, payload)
	for i := range body {
		body[i] = byte(i * 7919 % 251)
	}
	if err := os.WriteFile(filepath.Join(left, "payload.bin"), body, 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Each measurement gets its own configuration. The bucket is process-wide
	// regardless, which is why the limit is applied further down.
	ctx := context.Background()
	ctx, _ = rclonefs.AddConfig(ctx)
	if err := engine.StartAccounting(ctx, ""); err != nil {
		t.Fatalf("start accounting: %v", err)
	}

	// On macOS a local copy is an APFS clone that moves no bytes, which no
	// limit can slow down.
	leftFs, err := rclonefs.NewFs(ctx, ":local,no_clone=true:"+left)
	if err != nil {
		t.Fatalf("left: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, ":local,no_clone=true:"+right)
	if err != nil {
		t.Fatalf("right: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()

	opt := engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Transfers: 1}}

	// The bucket is made right before the clock starts. ApplyBwLimit replaces
	// it, so "off" does not inherit an earlier limit in the same process, and
	// an empty bucket refills during any setup that runs after it is made,
	// which a slow machine would bank as free transfer.
	if err := engine.ApplyBwLimit(ctx, bwLimit); err != nil {
		t.Fatalf("apply bandwidth limit %q: %v", bwLimit, err)
	}

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
