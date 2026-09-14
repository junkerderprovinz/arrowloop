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
	// What the limit implies for that payload: 512 KiB at 256 KiB/s is two
	// seconds, and the floor below keeps a wide margin under it.
	//
	// It used to keep that margin for the wrong reason - "rclone fills its
	// bucket before the first read, so the first burst is free" - and the
	// opposite is true. rclone hands out an EMPTY bucket (newEmptyTokenBucket
	// drains it the moment it is made) and lets it refill with elapsed time. So
	// nothing is free at the start, and every second between creating the bucket
	// and moving the first byte is a second of payload the limit will wave
	// through. That is why the bucket is now created immediately before the
	// measurement rather than during setup; see timeOneCopy.
	atLeast = 1500 * time.Millisecond
)

func TestTheBandwidthLimitActuallyLimits(t *testing.T) {
	unlimited := timeOneCopy(t, "off")
	limited := timeOneCopy(t, limit)
	t.Logf("unlimited %v, limited to %s %v", unlimited, limit, limited)

	// The baseline is a guard rather than a second assertion. A machine that
	// needs most of the floor to move these bytes with no limit at all cannot
	// tell a working limit from its own slowness, and a measurement that cannot
	// reach the failure should say so instead of reporting a colour.
	//
	// It also replaces the old "limited must be at least twice unlimited" check,
	// which fired alongside the floor below and turned one fault into two
	// messages. Past this guard that comparison is arithmetic, not evidence.
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
//
// bwLimit is rclone's own syntax and is never empty here: "off" is a real value
// that turns the limit off, while "" only means "do not touch it", which is a
// different thing and the wrong one for a measurement.
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

	// A context of its own for each measurement, so the two runs do not share a
	// configuration. The bucket itself is process-wide whatever the context says
	// - rclone keeps one - which is exactly why the limit is applied below
	// rather than here.
	ctx := context.Background()
	ctx, _ = rclonefs.AddConfig(ctx)
	if err := engine.StartAccounting(ctx, ""); err != nil {
		t.Fatalf("start accounting: %v", err)
	}

	// no_clone, and only for this measurement.
	//
	// macOS copies one local file to another by asking APFS to clone it, which
	// moves no bytes at all: the copy is a second reference to the same blocks.
	// That is faster than any limit and entirely correct, and it made this test
	// fail there while passing on Windows and Linux, which was the right
	// failure for the wrong reason. Turning cloning off is what makes the two
	// measurements comparable on every platform, and the thing being measured
	// is the token bucket rather than the filesystem.
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

	// The bucket is made here, one statement before the clock starts, and not up
	// with the rest of the setup. Two reasons, and the second one is why this
	// test was intermittent on the CI Windows runner:
	//
	//   - ApplyBwLimit REPLACES the bucket, so "off" is genuinely off. Starting
	//     accounting without a limit leaves whatever bucket the process already
	//     had, so the unlimited baseline quietly inherited the limit from an
	//     earlier run in the same binary. Visible with -count=3: the second
	//     "unlimited" measurement came out at 1.9s, the same as the limited one.
	//   - An empty bucket refills while the rest of the setup runs. Building two
	//     backends and opening the state database took about 1.4s on that
	//     runner, which banks roughly 360 KiB of the 512 KiB payload, and the
	//     copy then finished in 360ms. The slower the machine, the more it
	//     banks, so the test failed where it should have been most patient.
	//
	// With the bucket made here, everything that is left runs INSIDE the
	// measured window, where banking and waiting cancel out exactly: time spent
	// before the first byte moves is time the bucket spends filling, so the
	// total lands on the arithmetic either way.
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
