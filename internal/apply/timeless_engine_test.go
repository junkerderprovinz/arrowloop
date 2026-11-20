package apply_test

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

// A backup onto MEGA that already holds the file, with no record of it and
// left for later by earlier runs, sends it once, records the pair and leaves
// it alone from then on.
func TestABackupOntoABackendWithoutTimesSettlesAfterOneRun(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	left, right := filepath.Join(root, "left"), filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	written := time.Now().Add(-36 * time.Hour).Truncate(time.Second)
	stamp(t, filepath.Join(left, "backup.json"), "AAAA", written)
	stamp(t, filepath.Join(right, "backup.json"), "AAAA", written)

	leftFs, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left fs: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right fs: %v", err)
	}
	uploaded := time.Now()
	ends := apply.Ends{Left: leftFs, Right: apply.UploadStamped(rightFs, uploaded)}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()
	sent := &state.Sent{Side: "right", LeftPath: "backup.json", RightPath: "backup.json", Size: 4, Mod: uploaded}
	for range 18 {
		if _, err := db.InFlux(ctx, "backup.json", sent); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	opt := engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Direction: plan.LeftToRight}}

	if _, res, err := engine.Once(ctx, ends, db, opt); err != nil || len(res.Skipped) != 0 {
		t.Fatalf("first run: %v, left for later: %+v", err, res.Skipped)
	}
	if _, ok, _ := db.Get(ctx, "backup.json"); !ok {
		t.Fatal("the pair has no record after the first run")
	}
	_, res, err := engine.Once(ctx, ends, db, opt)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if res.Copied != 0 || len(res.Skipped) != 0 {
		t.Errorf("the second run copied %d and left %+v for later, wanted nothing to do", res.Copied, res.Skipped)
	}
}
