package apply_test

import (
	"context"
	"fmt"
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

// timelessPair is a phone folder and a WebDAV share that keeps no times and no
// checksums, such as Stalwart's, both already holding the same twelve files.
// Twelve is past the brakes' floor, so a run that overwrote them all would be
// refused.
func timelessPair(t *testing.T) (apply.Ends, *state.DB, time.Time, []string) {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	left, right := filepath.Join(root, "left"), filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	written := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	var names []string
	for i := range 12 {
		name := fmt.Sprintf("note-%02d.txt", i)
		body := fmt.Sprintf("note number %d", i)
		stamp(t, filepath.Join(left, name), body, written)
		stamp(t, filepath.Join(right, name), body, written)
		names = append(names, name)
	}

	leftFs, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left fs: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right fs: %v", err)
	}
	uploaded := time.Now().Add(-time.Hour).Truncate(time.Second)
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return apply.Ends{Left: leftFs, Right: apply.UploadStamped(rightFs, uploaded)}, db, uploaded, names
}

func twoWay() engine.Options {
	opt := plan.DefaultOptions()
	opt.Direction = plan.Both
	return engine.Options{Compare: opt}
}

// settlesQuietly runs the job twice and wants every pair recorded without a
// byte sent, then nothing left to do.
func settlesQuietly(t *testing.T, ends apply.Ends, db *state.DB, names []string) {
	t.Helper()
	ctx := context.Background()
	_, res, err := engine.Once(ctx, ends, db, twoWay())
	if err != nil {
		t.Fatalf("first run: %v", err)
	}
	if res.Copied != 0 || res.Conflicts != 0 || len(res.Skipped) != 0 {
		t.Errorf("first run copied %d, made %d conflicts and left %+v for later, wanted only records",
			res.Copied, res.Conflicts, res.Skipped)
	}
	for _, name := range names {
		if _, ok, _ := db.Get(ctx, name); !ok {
			t.Errorf("%s has no record after the first run", name)
		}
	}
	_, res, err = engine.Once(ctx, ends, db, twoWay())
	if err != nil {
		t.Fatalf("second run: %v", err)
	}
	if res.Copied != 0 || res.Conflicts != 0 {
		t.Errorf("second run copied %d and made %d conflicts, wanted nothing to do", res.Copied, res.Conflicts)
	}
}

// A job an older version left with every file in flux, because it took the
// share's upload times for a change, records the pairs it finds equal instead
// of sending them all again into the change brake.
func TestATwoWayJobLeftInFluxOnABackendWithoutTimesRecoversWithoutTheBrake(t *testing.T) {
	ends, db, uploaded, names := timelessPair(t)
	ctx := context.Background()
	for i, name := range names {
		sent := &state.Sent{Side: "right", LeftPath: name, RightPath: name,
			Size: int64(len(fmt.Sprintf("note number %d", i))), Mod: uploaded}
		if _, err := db.InFlux(ctx, name, sent); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	settlesQuietly(t, ends, db, names)
}

// The first run of a two-way job between a folder and a share that keeps no
// times agrees on files both already hold, rather than keeping both of each.
func TestTwoTreesMeetingOnABackendWithoutTimesAgreeOnEqualFiles(t *testing.T) {
	ends, db, _, names := timelessPair(t)
	settlesQuietly(t, ends, db, names)
}
