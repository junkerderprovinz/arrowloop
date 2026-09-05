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

// Everything else in this package syncs one local folder to another, which
// tests the engine against exactly one kind of backend: the one with real
// directories, real modification times, and a filesystem underneath. The whole
// point of embedding rclone is that a side can be something else entirely, and
// none of that was being exercised.
//
// The memory backend is that something else, in process and without a
// credential: it is BUCKET-BASED like S3, so it reports that it cannot hold an
// empty directory, and what looks like a folder in it is only a shared prefix
// on the keys. That is the shape the engine has the most assumptions about.
//
// This is not a substitute for running against a real S3 bucket or a real SFTP
// host, and it is not claimed as one. It is the part of that gap which can be
// closed without asking anybody for a server.

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
	// A bucket name per test, because the memory backend keeps its contents in
	// one process-wide place and two tests sharing a bucket would be reading
	// each other's files.
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

// contents reads a whole side through rclone, so it works for any backend
// rather than only for one with a filesystem underneath.
func contents(t *testing.T, f rclonefs.Fs) map[string]string {
	t.Helper()
	return read(t, f, false)
}

// everything includes the tool's own reserved area, which contents deliberately
// hides. Comparing the two sides has to ignore it, because a deletion puts the
// old object in the losing side's trash and only that side then carries it.
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
// non-local, bucket-shaped side: files appear, change, move and go away.
func TestABucketSideConverges(t *testing.T) {
	m := newMixed(t, "converge")

	for i := range 12 {
		write(t, m.local, fmt.Sprintf("dir%d/file%02d.txt", i%3, i), fmt.Sprintf("initial %d", i))
	}
	if _, res := m.sync(t); res.Copied != 12 {
		t.Fatalf("expected twelve files into the bucket, got %d", res.Copied)
	}
	requireSame(t, m, "after the first run")

	// A second run must find nothing to do. This is where a backend that
	// cannot store a modification time, or stores it at a different
	// resolution, shows up: every file would look changed forever.
	p, res := m.sync(t)
	if len(p.Actions) != 0 || res.Copied != 0 {
		t.Fatalf("the job did not settle against a bucket: %d actions, %d copied again", len(p.Actions), res.Copied)
	}
	if p.Unchanged != 12 {
		t.Fatalf("only %d of 12 were recognised as unchanged", p.Unchanged)
	}

	// An edit on the local side.
	write(t, m.local, "dir0/file00.txt", "edited on the local side")
	if _, res := m.sync(t); res.Copied != 1 {
		t.Fatalf("an edit did not reach the bucket: %d copied", res.Copied)
	}
	requireSame(t, m, "after an edit")

	// A deletion on the local side has to propagate, and the removed object
	// has to end up in the bucket's own trash rather than simply going.
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

// TestARenameIsAMoveInABucket checks the optimisation that matters most over a
// network. A bucket has no rename, so rclone has to do it as a server-side copy
// followed by a delete, and the engine has to still recognise the situation as
// one move rather than as a delete plus a fresh upload.
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

// TestABucketRefusesEmptyFolders pins the capability check rather than the
// wish. A bucket has no directories, only shared key prefixes, so a folder
// created there would vanish the moment nothing used the prefix and the job
// would report making the same folder on every single run.
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

	// And the run still settles, which is the failure this guard prevents:
	// a folder created on a bucket disappears again, so the next run would
	// propose creating it once more, forever.
	p, _ = m.sync(t)
	if len(p.Dirs) != 0 || len(p.Actions) != 0 {
		t.Fatalf("the job did not settle: %d folder actions, %d actions", len(p.Dirs), len(p.Actions))
	}
}

// TestAConflictResolvesAcrossABucket covers the manoeuvre that takes three
// filesystem operations, on a backend where one of those operations does not
// exist natively.
func TestAConflictResolvesAcrossABucket(t *testing.T) {
	ctx := context.Background()
	m := newMixed(t, "conflict")
	write(t, m.local, "notes.txt", "the original")
	m.sync(t)

	write(t, m.local, "notes.txt", "the local version")
	time.Sleep(10 * time.Millisecond)
	// Change the bucket's copy behind the engine's back, which is what a second
	// machine writing to the same bucket looks like from here.
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

	// And it has to settle, or the job reports the same conflict forever.
	p, _ := m.sync(t)
	if len(p.Actions) != 0 {
		t.Fatalf("the conflict did not settle: %d actions left", len(p.Actions))
	}
}
