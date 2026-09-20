// Package scenario runs the engine end to end against real folders.
//
// The interesting failures of a two-way sync come from sequences nobody
// thought to write down, so the main test generates them from seeds and checks
// one property each time: after a run, both sides hold exactly the same files.
package scenario

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

type job struct {
	left  string
	right string
	ends  apply.Ends
	db    *state.DB
	opt   engine.Options
}

func newJob(t *testing.T, opt engine.Options) *job {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", d, err)
		}
	}
	leftFs, err := rclonefs.NewFs(ctx, left)
	if err != nil {
		t.Fatalf("left fs: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, right)
	if err != nil {
		t.Fatalf("right fs: %v", err)
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	return &job{left: left, right: right, ends: apply.Ends{Left: leftFs, Right: rightFs}, db: db, opt: opt}
}

// quick is the comparison used by most tests: brakes off, and no settling
// delay, because a test writes a file and syncs it in the same millisecond.
func quick() engine.Options {
	return engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second}}
}

// guarded is the real default, brakes and all.
func guarded() engine.Options {
	c := plan.DefaultOptions()
	c.QuietPeriod = 0
	return engine.Options{Compare: c}
}

func (j *job) sync(t *testing.T) (*plan.Plan, apply.Result) {
	t.Helper()
	p, res, err := engine.Once(context.Background(), j.ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	return p, res
}

// tree reads one side as a map of relative path to content hash, skipping the
// tool's own reserved area.
func tree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if scan.IsReserved(rel) {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		sum := md5.Sum(data)
		out[rel] = hex.EncodeToString(sum[:])
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	return out
}

func requireConverged(t *testing.T, j *job, when string) {
	t.Helper()
	left, right := tree(t, j.left), tree(t, j.right)
	if len(left) != len(right) {
		t.Fatalf("%s: left has %d files, right has %d\n left:  %v\n right: %v", when, len(left), len(right), keys(left), keys(right))
	}
	for path, sum := range left {
		other, ok := right[path]
		if !ok {
			t.Fatalf("%s: %q exists on the left but not on the right", when, path)
		}
		if other != sum {
			t.Fatalf("%s: %q differs between the sides", when, path)
		}
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", rel, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

// TestConvergence applies a different sequence of edits to both sides for each
// seed and requires the sides to hold the same files after every sync.
func TestConvergence(t *testing.T) {
	for _, seed := range []int64{1, 2, 3, 7, 11, 23, 42, 99} {
		t.Run(fmt.Sprintf("seed-%d", seed), func(t *testing.T) {
			// Random edits often delete a large share of a small tree, which
			// would trip the brake.
			j := newJob(t, quick())
			rnd := rand.New(rand.NewSource(seed))

			for i := range 12 {
				write(t, j.left, fmt.Sprintf("dir%d/file%02d.txt", i%3, i), fmt.Sprintf("seed %d initial %d", seed, i))
			}
			j.sync(t)
			requireConverged(t, j, "after the first run")

			for round := range 8 {
				mutate(t, rnd, j.left)
				mutate(t, rnd, j.right)
				j.sync(t)
				requireConverged(t, j, fmt.Sprintf("after round %d", round))
			}
		})
	}
}

// mutate applies one random change to a side.
func mutate(t *testing.T, rnd *rand.Rand, root string) {
	t.Helper()
	existing := keys(tree(t, root))
	pick := func() string {
		if len(existing) == 0 {
			return ""
		}
		return existing[rnd.Intn(len(existing))]
	}

	switch rnd.Intn(4) {
	case 0: // create
		write(t, root, fmt.Sprintf("dir%d/new%d.txt", rnd.Intn(3), rnd.Intn(10000)), fmt.Sprintf("created %d", rnd.Int63()))
	case 1: // edit
		if p := pick(); p != "" {
			write(t, root, p, fmt.Sprintf("edited %d", rnd.Int63()))
		}
	case 2: // delete
		if p := pick(); p != "" {
			if err := os.Remove(filepath.Join(root, filepath.FromSlash(p))); err != nil {
				t.Fatalf("remove %s: %v", p, err)
			}
		}
	case 3: // rename
		if p := pick(); p != "" {
			dst := fmt.Sprintf("dir%d/moved%d.txt", rnd.Intn(3), rnd.Intn(10000))
			full := filepath.Join(root, filepath.FromSlash(dst))
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				t.Fatalf("mkdir for %s: %v", dst, err)
			}
			if err := os.Rename(filepath.Join(root, filepath.FromSlash(p)), full); err != nil {
				t.Fatalf("rename %s: %v", p, err)
			}
		}
	}
}

func TestDeleteGoesToTrash(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "keep.txt", "keep me")
	write(t, j.left, "doomed.txt", "delete me")
	j.sync(t)
	requireConverged(t, j, "after the first run")

	if err := os.Remove(filepath.Join(j.left, "doomed.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	_, res := j.sync(t)
	if res.Trashed != 1 {
		t.Fatalf("expected exactly one file trashed, got %d", res.Trashed)
	}
	requireConverged(t, j, "after the deletion")

	if _, err := os.Stat(filepath.Join(j.right, "doomed.txt")); !os.IsNotExist(err) {
		t.Error("the file is still in place on the right side")
	}
	var found string
	filepath.WalkDir(filepath.Join(j.right, filepath.FromSlash(scan.TrashDir)), func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, "doomed.txt") {
			found = p
		}
		return nil
	})
	if found == "" {
		t.Fatal("the deleted file is not in the trash; it is simply gone")
	}
	data, err := os.ReadFile(found)
	if err != nil || string(data) != "delete me" {
		t.Errorf("the trashed copy does not hold the original content: %q, %v", data, err)
	}
}

func TestRenameBecomesAMove(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "holiday/IMG_1.jpg", "pretend this is a large photo")
	j.sync(t)

	if err := os.Rename(filepath.Join(j.left, "holiday", "IMG_1.jpg"), filepath.Join(j.left, "holiday", "sunset.jpg")); err != nil {
		t.Fatalf("rename: %v", err)
	}
	_, res := j.sync(t)
	if res.Moved != 1 || res.Copied != 0 || res.Trashed != 0 {
		t.Fatalf("expected one move and nothing else, got %d moved, %d copied, %d trashed", res.Moved, res.Copied, res.Trashed)
	}
	requireConverged(t, j, "after the rename")
}

// Neither edit is lost, and the next run has nothing left to do.
func TestConflictKeepsBothVersions(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "notes.txt", "original")
	j.sync(t)

	write(t, j.left, "notes.txt", "the left version")
	time.Sleep(10 * time.Millisecond)
	write(t, j.right, "notes.txt", "the right version")

	_, res := j.sync(t)
	if res.Conflicts != 1 {
		t.Fatalf("expected one conflict, got %d", res.Conflicts)
	}
	requireConverged(t, j, "after the conflict")

	found := tree(t, j.left)
	var kept []string
	for p := range found {
		kept = append(kept, p)
	}
	if len(kept) != 2 {
		t.Fatalf("expected the surviving file plus one conflict copy, got %v", kept)
	}

	var texts []string
	for p := range found {
		data, err := os.ReadFile(filepath.Join(j.left, filepath.FromSlash(p)))
		if err != nil {
			t.Fatalf("read %s: %v", p, err)
		}
		texts = append(texts, string(data))
	}
	for _, want := range []string{"the left version", "the right version"} {
		var seen bool
		for _, got := range texts {
			if got == want {
				seen = true
			}
		}
		if !seen {
			t.Errorf("%q was lost in the conflict resolution; kept %v", want, texts)
		}
	}

	p2, _ := j.sync(t)
	if len(p2.Actions) != 0 {
		t.Errorf("the conflict did not settle, the next run still wants to do %d things", len(p2.Actions))
	}
}

// A disk that did not mount looks like a folder whose contents were deleted.
func TestBrakeStopsAnUnmountedSide(t *testing.T) {
	j := newJob(t, guarded())
	for i := range 30 {
		write(t, j.left, fmt.Sprintf("f%02d.txt", i), fmt.Sprintf("content %d", i))
	}
	j.sync(t)
	requireConverged(t, j, "after the first run")

	// The left side fails to mount.
	entries, err := os.ReadDir(j.left)
	if err != nil {
		t.Fatalf("read left: %v", err)
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(j.left, e.Name())); err != nil {
			t.Fatalf("clear left: %v", err)
		}
	}

	_, _, err = engine.Once(context.Background(), j.ends, j.db, j.opt)
	if err == nil {
		t.Fatal("an empty side was accepted and 30 files would have been deleted on the right")
	}
	if len(tree(t, j.right)) != 30 {
		t.Fatalf("the right side was damaged anyway, %d files left", len(tree(t, j.right)))
	}
}

// Five deletions are below the brake's floor, so only the empty-side guard
// protects a small job.
func TestSmallSideVanishing(t *testing.T) {
	opt := guarded()
	j := newJob(t, opt)
	for i := range 5 {
		write(t, j.left, fmt.Sprintf("small%d.txt", i), fmt.Sprintf("content %d", i))
	}
	j.sync(t)
	requireConverged(t, j, "after the first run")

	entries, err := os.ReadDir(j.left)
	if err != nil {
		t.Fatalf("read left: %v", err)
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(j.left, e.Name())); err != nil {
			t.Fatalf("clear left: %v", err)
		}
	}

	if 5 > opt.Compare.BrakeFloor {
		t.Fatalf("this test only proves anything while the brake floor (%d) is above the file count", opt.Compare.BrakeFloor)
	}

	_, _, err = engine.Once(context.Background(), j.ends, j.db, j.opt)
	if err == nil {
		t.Fatal("a vanished small side was accepted; five files would have been deleted on the right")
	}
	var emptySide *plan.EmptySideError
	if !errors.As(err, &emptySide) {
		t.Fatalf("got %v, want the empty-side refusal", err)
	}
	if len(tree(t, j.right)) != 5 {
		t.Fatalf("the right side was damaged anyway, %d files left", len(tree(t, j.right)))
	}
}
