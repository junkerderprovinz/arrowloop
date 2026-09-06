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

// A one-way job is not a two-way job with half the actions removed.
//
// Filtering would leave a job that never settles: the far side's own edit would
// be skipped, reported again on the next run, and again for ever. What a
// direction means is that one side is right and the other is made to agree with
// it, so every action is REWRITTEN to run that way or dropped.

// TestOneWayNeverWritesToItsSource is the promise the whole setting rests on.
func TestOneWayNeverWritesToItsSource(t *testing.T) {
	j := oneWay(t, plan.LeftToRight)

	// Two files, not one. Emptying a side completely is refused by the
	// empty-side guard whatever the direction says, and rightly: an unmounted
	// destination looks exactly like a destination somebody emptied. What is
	// under test here is a deletion, not that guard.
	write(t, j.left, "from-the-source.txt", "written on the left")
	write(t, j.left, "keeps-the-side-populated.txt", "so a side never lists nothing")
	if _, res := j.run(t); res.Copied != 2 {
		t.Fatalf("new files on the source did not travel: %d copied", res.Copied)
	}

	// The far side edits something. A two-way job would carry that back; a
	// one-way job puts the source's version over it, because the source is what
	// the setting says is right.
	write(t, j.right, "from-the-source.txt", "written on the RIGHT, which does not decide")
	p, res := j.run(t)
	if res.Copied != 1 {
		t.Fatalf("the far side's edit was not undone: %d copied, plan %+v", res.Copied, p.Actions)
	}
	if got := readFile(t, j.left, "from-the-source.txt"); got != "written on the left" {
		t.Fatalf("the source was written to: it now holds %q", got)
	}
	if got := readFile(t, j.right, "from-the-source.txt"); got != "written on the left" {
		t.Errorf("the destination was not brought back into line: %q", got)
	}

	// The far side deletes something. The source still has it, so it comes back
	// rather than being deleted on the source.
	if err := os.Remove(filepath.Join(j.right, "from-the-source.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := j.run(t); res.Copied != 1 || res.Trashed != 0 {
		t.Fatalf("a deletion on the destination did not come back: %d copied, %d trashed", res.Copied, res.Trashed)
	}
	if _, err := os.Stat(filepath.Join(j.left, "from-the-source.txt")); err != nil {
		t.Errorf("the file was removed from the source: %v", err)
	}

	// A deletion on the SOURCE does propagate, because that is the one
	// direction this job is for.
	if err := os.Remove(filepath.Join(j.left, "from-the-source.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := j.run(t); res.Trashed != 1 {
		t.Fatalf("a deletion on the source did not propagate: %d trashed", res.Trashed)
	}

	// And it settles. A one-way job that keeps proposing the same undo every
	// run is the failure this rewrite exists to prevent.
	if p, res := j.run(t); len(p.Actions) != 0 || res.Copied != 0 {
		t.Fatalf("the one-way job did not settle: %d actions, %d copied", len(p.Actions), res.Copied)
	}
}

// TestOneWayLeavesWhatTheSourceNeverHad is the line between copying and
// mirroring, and it is deliberate.
//
// Deleting something the source has never known about is not propagating
// somebody's decision, it is making one on their behalf. A file that only ever
// existed on the destination stays there.
func TestOneWayLeavesWhatTheSourceNeverHad(t *testing.T) {
	j := oneWay(t, plan.LeftToRight)
	write(t, j.left, "shared.txt", "from the source")
	j.run(t)

	write(t, j.right, "only-here.txt", "made on the destination and never on the source")
	p, res := j.run(t)
	if res.Trashed != 0 {
		t.Errorf("a file the source never had was deleted: %+v", p.Actions)
	}
	if res.Copied != 0 {
		t.Errorf("a file the source never had was copied back to it: %+v", p.Actions)
	}
	if _, err := os.Stat(filepath.Join(j.right, "only-here.txt")); err != nil {
		t.Errorf("the destination's own file is gone: %v", err)
	}
	if _, err := os.Stat(filepath.Join(j.left, "only-here.txt")); err == nil {
		t.Error("the destination's own file was carried onto the source")
	}
}

// TestTheOtherDirectionIsTheMirrorImage. The two settings must not be one
// working feature and one that was written from memory.
func TestTheOtherDirectionIsTheMirrorImage(t *testing.T) {
	j := oneWay(t, plan.RightToLeft)
	write(t, j.right, "from-the-source.txt", "written on the right")
	if _, res := j.run(t); res.Copied != 1 {
		t.Fatalf("a new file on the source did not travel: %d copied", res.Copied)
	}

	write(t, j.left, "from-the-source.txt", "written on the LEFT, which does not decide")
	if _, res := j.run(t); res.Copied != 1 {
		t.Fatalf("the far side's edit was not undone: %d copied", res.Copied)
	}
	if got := readFile(t, j.right, "from-the-source.txt"); got != "written on the right" {
		t.Fatalf("the source was written to: it now holds %q", got)
	}
	if got := readFile(t, j.left, "from-the-source.txt"); got != "written on the right" {
		t.Errorf("the destination was not brought back into line: %q", got)
	}
}

// TestBothWaysIsUntouched. A direction nobody set must behave exactly as this
// program did before the setting existed.
func TestBothWaysIsUntouched(t *testing.T) {
	j := oneWay(t, plan.Both)
	write(t, j.left, "l.txt", "left")
	write(t, j.right, "r.txt", "right")
	if _, res := j.run(t); res.Copied != 2 {
		t.Fatalf("a two-way job did not carry both files: %d copied", res.Copied)
	}

	// And a genuine disagreement is still a conflict, with both versions kept.
	write(t, j.left, "l.txt", "changed on the left")
	time.Sleep(1100 * time.Millisecond)
	write(t, j.right, "l.txt", "changed on the right")
	if _, res := j.run(t); res.Conflicts != 1 {
		t.Fatalf("a two-way job stopped treating a disagreement as a conflict: %d conflicts", res.Conflicts)
	}
}

// ---------------------------------------------------------------------------

type directed struct {
	left, right string
	ends        apply.Ends
	db          *state.DB
	opt         engine.Options
}

func oneWay(t *testing.T, dir plan.Direction) *directed {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	left := filepath.Join(root, "left")
	right := filepath.Join(root, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
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
	t.Cleanup(func() { db.Close() })

	return &directed{
		left: left, right: right,
		ends: apply.Ends{Left: leftFs, Right: rightFs},
		db:   db,
		opt: engine.Options{Compare: plan.Options{
			ModWindow: 2 * time.Second, Transfers: 4, Direction: dir,
		}},
	}
}

func (d *directed) run(t *testing.T) (*plan.Plan, apply.Result) {
	t.Helper()
	p, res, err := engine.Once(context.Background(), d.ends, d.db, d.opt)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return p, res
}

func readFile(t *testing.T, dir, name string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(body)
}
