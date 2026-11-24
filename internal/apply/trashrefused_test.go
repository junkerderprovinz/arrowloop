package apply_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// syncedPair is a two-way job whose first run has carried a few files from
// left to right, with a file on the right where the reserved folder would go,
// which refuses that folder the way a server root does that the login may not
// write in.
type syncedPair struct {
	left, right string
	ends        apply.Ends
	db          *state.DB
	opt         engine.Options
}

func newSyncedPair(t *testing.T) *syncedPair {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	p := &syncedPair{left: filepath.Join(root, "left"), right: filepath.Join(root, "right")}
	for _, d := range []string{p.left, p.right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	written := time.Now().Add(-time.Hour).Truncate(time.Second)
	for _, name := range []string{"a.txt", "b.txt", "c.txt", "d.txt", "e.txt"} {
		stamp(t, filepath.Join(p.left, name), "first", written)
	}
	for i, dir := range []string{p.left, p.right} {
		f, err := rclonefs.NewFs(ctx, dir)
		if err != nil {
			t.Fatalf("fs: %v", err)
		}
		if i == 0 {
			p.ends.Left = f
		} else {
			p.ends.Right = f
		}
	}
	db, err := state.Open(ctx, filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	p.db = db
	p.opt = engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second, Direction: plan.Both}}
	if _, _, err := engine.Once(ctx, p.ends, db, p.opt); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if err := os.WriteFile(filepath.Join(p.right, scan.MetaDir), []byte("in the way"), 0o644); err != nil {
		t.Fatalf("block the reserved folder: %v", err)
	}
	return p
}

func (p *syncedPair) run(ctx context.Context) error {
	_, _, err := engine.Once(ctx, p.ends, p.db, p.opt)
	return err
}

func there(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	return err == nil
}

// A deletion with nowhere to put the file stops the run before it changes
// anything, so no work is left lying around run after run.
func TestARunThatCannotKeepItsTrashStopsBeforeItChangesAnything(t *testing.T) {
	p := newSyncedPair(t)
	if err := os.Remove(filepath.Join(p.left, "a.txt")); err != nil {
		t.Fatal(err)
	}
	stamp(t, filepath.Join(p.left, "new.txt"), "new", time.Now().Add(-time.Hour))

	err := p.run(context.Background())

	var refused *apply.TrashRefusedError
	if !errors.As(err, &refused) {
		t.Fatalf("the run ended with %v, want the trash refused", err)
	}
	if refused.Side != plan.Right {
		t.Errorf("the refusal names the %s side, want the right", refused.Side)
	}
	if !there(t, filepath.Join(p.right, "a.txt")) {
		t.Error("the file was deleted without a trash to keep it in")
	}
	if there(t, filepath.Join(p.right, "new.txt")) {
		t.Error("the run went on copying after it found the trash refused")
	}
}

func TestAJobWithoutATrashDeletesWhereTheTrashIsRefused(t *testing.T) {
	p := newSyncedPair(t)
	if err := os.Remove(filepath.Join(p.left, "a.txt")); err != nil {
		t.Fatal(err)
	}

	if err := p.run(apply.WithTrash(context.Background(), false)); err != nil {
		t.Fatalf("run: %v", err)
	}
	if there(t, filepath.Join(p.right, "a.txt")) {
		t.Error("the file is still there")
	}
}

func TestAnOverwriteThatWouldKeepAnOldVersionStopsWhereTheFolderIsRefused(t *testing.T) {
	p := newSyncedPair(t)
	stamp(t, filepath.Join(p.left, "a.txt"), "second", time.Now().Add(-time.Minute))

	err := p.run(apply.WithVersions(context.Background(), 3))

	var refused *apply.TrashRefusedError
	if !errors.As(err, &refused) || refused.Side != plan.Right {
		t.Fatalf("the run ended with %v, want the right side's folder refused", err)
	}
}

// A run that only adds files needs no trash, so the refused folder does not
// hold it up.
func TestARunWithNothingToSetAsideIsNotStopped(t *testing.T) {
	p := newSyncedPair(t)
	stamp(t, filepath.Join(p.left, "new.txt"), "new", time.Now().Add(-time.Hour))

	if err := p.run(apply.WithVersions(context.Background(), 3)); err != nil {
		t.Fatalf("run: %v", err)
	}
	if !there(t, filepath.Join(p.right, "new.txt")) {
		t.Error("the new file was not copied")
	}
}

func TestAChoiceOnAConflictStopsWhereTheTrashIsRefused(t *testing.T) {
	p := newSyncedPair(t)
	ctx := context.Background()
	edited := time.Now().Add(-time.Minute)
	stamp(t, filepath.Join(p.left, "a.txt"), "left edit", edited)
	stamp(t, filepath.Join(p.right, "a.txt"), "right edit", edited.Add(time.Second))
	if err := p.run(ctx); err != nil {
		t.Fatalf("keeping both versions needs no trash, yet the run failed: %v", err)
	}
	open, err := engine.Conflicts(ctx, p.ends, p.db, p.opt)
	if err != nil || len(open) != 1 {
		t.Fatalf("open conflicts: %+v, %v", open, err)
	}

	_, err = engine.Decide(ctx, p.ends, p.db, []apply.Decision{{Copy: open[0].Copy, Keep: plan.KeepLeft}}, p.opt, nil)

	var refused *apply.TrashRefusedError
	if !errors.As(err, &refused) {
		t.Fatalf("the choice ended with %v, want the trash refused", err)
	}
	if !there(t, filepath.Join(p.right, open[0].Copy)) && !there(t, filepath.Join(p.left, open[0].Copy)) {
		t.Error("the set-aside copy went without a trash to keep it in")
	}
}
