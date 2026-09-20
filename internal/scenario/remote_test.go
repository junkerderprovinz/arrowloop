package scenario

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/object"
	"github.com/rclone/rclone/fs/walk"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/memory"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// These tests put the right side on rclone's memory backend, which is
// bucket-based like S3: it cannot hold an empty directory, and a folder in it
// is only a shared key prefix.

type mixed struct {
	local string
	ends  apply.Ends
	db    *state.DB
	opt   engine.Options
}

func newMixed(t *testing.T, bucket string) *mixed {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	local := filepath.Join(root, "local")
	if err := os.MkdirAll(local, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	leftFs, err := rclonefs.NewFs(ctx, local)
	if err != nil {
		t.Fatalf("local side: %v", err)
	}
	// The memory backend is process-wide, so each test uses its own bucket.
	rightFs, err := rclonefs.NewFs(ctx, ":memory:"+bucket)
	if err != nil {
		t.Fatalf("memory side: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	return &mixed{
		local: local,
		ends:  apply.Ends{Left: leftFs, Right: rightFs},
		db:    db,
		opt:   engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Transfers: 4}},
	}
}

func (m *mixed) sync(t *testing.T) (*plan.Plan, apply.Result) {
	t.Helper()
	p, res, err := engine.Once(context.Background(), m.ends, m.db, m.opt)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	return p, res
}

// contents reads a whole side through rclone, without the reserved area.
func contents(t *testing.T, f rclonefs.Fs) map[string]string {
	t.Helper()
	return read(t, f, false)
}

// everything reads a whole side including the reserved area. Only the side
// that deleted a file holds it in its trash, so comparisons use contents.
func everything(t *testing.T, f rclonefs.Fs) map[string]string {
	t.Helper()
	return read(t, f, true)
}

func read(t *testing.T, f rclonefs.Fs, includeReserved bool) map[string]string {
	t.Helper()
	ctx := context.Background()
	out := map[string]string{}
	err := walk.ListR(ctx, f, "", true, -1, walk.ListObjects, func(entries rclonefs.DirEntries) error {
		for _, entry := range entries {
			obj, ok := entry.(rclonefs.Object)
			if !ok {
				continue
			}
			if !includeReserved && scan.IsReserved(obj.Remote()) {
				continue
			}
			r, err := obj.Open(ctx)
			if err != nil {
				return err
			}
			body, err := io.ReadAll(r)
			r.Close()
			if err != nil {
				return err
			}
			out[obj.Remote()] = string(body)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("read %s: %v", f.Name(), err)
	}
	return out
}

func requireSame(t *testing.T, m *mixed, when string) {
	t.Helper()
	left, right := contents(t, m.ends.Left), contents(t, m.ends.Right)
	if len(left) != len(right) {
		t.Fatalf("%s: local holds %d, the bucket holds %d\n local:  %v\n bucket: %v",
			when, len(left), len(right), keys(left), keys(right))
	}
	for name, body := range left {
		if right[name] != body {
			t.Fatalf("%s: %q differs between the sides", when, name)
		}
	}
}

// TestABucketSideConverges runs the ordinary life of a job against a
// bucket-shaped side: files appear, change and go away.
func TestABucketSideConverges(t *testing.T) {
	m := newMixed(t, "converge")

	for i := range 12 {
		write(t, m.local, fmt.Sprintf("dir%d/file%02d.txt", i%3, i), fmt.Sprintf("initial %d", i))
	}
	if _, res := m.sync(t); res.Copied != 12 {
		t.Fatalf("expected twelve files into the bucket, got %d", res.Copied)
	}
	requireSame(t, m, "after the first run")

	// A backend that loses modification times would make every file look
	// changed.
	p, res := m.sync(t)
	if len(p.Actions) != 0 || res.Copied != 0 {
		t.Fatalf("the job did not settle against a bucket: %d actions, %d copied again", len(p.Actions), res.Copied)
	}
	if p.Unchanged != 12 {
		t.Fatalf("only %d of 12 were recognised as unchanged", p.Unchanged)
	}

	write(t, m.local, "dir0/file00.txt", "edited on the local side")
	if _, res := m.sync(t); res.Copied != 1 {
		t.Fatalf("an edit did not reach the bucket: %d copied", res.Copied)
	}
	requireSame(t, m, "after an edit")

	if err := os.Remove(filepath.Join(m.local, "dir1", "file01.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := m.sync(t); res.Trashed != 1 {
		t.Fatalf("a deletion did not propagate to the bucket: %d trashed", res.Trashed)
	}
	requireSame(t, m, "after a deletion")

	var trashed bool
	for name := range everything(t, m.ends.Right) {
		if scan.IsReserved(name) {
			trashed = true
		}
	}
	if !trashed {
		t.Error("the deleted object is not in the bucket's trash; it is simply gone")
	}
}

// A bucket has no rename, so rclone does a server-side copy and a delete; the
// engine still has to see one move.
func TestARenameIsAMoveInABucket(t *testing.T) {
	m := newMixed(t, "rename")
	write(t, m.local, "holiday/IMG_1.jpg", "pretend this is a large photo")
	m.sync(t)

	if err := os.Rename(
		filepath.Join(m.local, "holiday", "IMG_1.jpg"),
		filepath.Join(m.local, "holiday", "sunset.jpg"),
	); err != nil {
		t.Fatalf("rename: %v", err)
	}

	_, res := m.sync(t)
	if res.Moved != 1 || res.Copied != 0 || res.Trashed != 0 {
		t.Fatalf("expected one move and nothing else, got %d moved, %d copied, %d trashed",
			res.Moved, res.Copied, res.Trashed)
	}
	requireSame(t, m, "after a rename")
}

// A folder created in a bucket vanishes again, so the job would create it on
// every run.
func TestABucketRefusesEmptyFolders(t *testing.T) {
	m := newMixed(t, "emptydirs")
	m.opt.EmptyDirs = true

	if err := os.MkdirAll(filepath.Join(m.local, "waiting-for-photos"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	write(t, m.local, "real.txt", "content")

	p, res := m.sync(t)
	if res.DirsMade != 0 || len(p.Dirs) != 0 {
		t.Fatalf("folders were carried to a backend that cannot hold them: %d made, %d planned",
			res.DirsMade, len(p.Dirs))
	}
	if res.Copied != 1 {
		t.Fatalf("the real file did not cross: %d copied", res.Copied)
	}

	p, _ = m.sync(t)
	if len(p.Dirs) != 0 || len(p.Actions) != 0 {
		t.Fatalf("the job did not settle: %d folder actions, %d actions", len(p.Dirs), len(p.Actions))
	}
}

// Resolving a conflict renames a file, which a bucket cannot do natively.
func TestAConflictResolvesAcrossABucket(t *testing.T) {
	ctx := context.Background()
	m := newMixed(t, "conflict")
	write(t, m.local, "notes.txt", "the original")
	m.sync(t)

	write(t, m.local, "notes.txt", "the local version")
	time.Sleep(10 * time.Millisecond)
	// Another machine writes to the same bucket.
	body := "the bucket version"
	info := object.NewStaticObjectInfo("notes.txt", time.Now(), int64(len(body)), true, nil, m.ends.Right)
	if _, err := m.ends.Right.Put(ctx, strings.NewReader(body), info); err != nil {
		t.Fatalf("write into the bucket: %v", err)
	}

	_, res := m.sync(t)
	if res.Conflicts != 1 {
		t.Fatalf("expected one conflict, got %d", res.Conflicts)
	}
	requireSame(t, m, "after a conflict")

	both := contents(t, m.ends.Left)
	var seenLocal, seenBucket bool
	for _, body := range both {
		if body == "the local version" {
			seenLocal = true
		}
		if body == "the bucket version" {
			seenBucket = true
		}
	}
	if !seenLocal || !seenBucket {
		t.Fatalf("a version was lost resolving a conflict across a bucket: %v", both)
	}

	p, _ := m.sync(t)
	if len(p.Actions) != 0 {
		t.Fatalf("the conflict did not settle: %d actions left", len(p.Actions))
	}
}
