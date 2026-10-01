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

func TestOneWayNeverWritesToItsSource(t *testing.T) {
	j := oneWay(t, plan.LeftToRight)

	// A second file keeps the side from emptying, which the empty-side guard
	// would refuse.
	write(t, j.left, "from-the-source.txt", "written on the left")
	write(t, j.left, "keeps-the-side-populated.txt", "so a side never lists nothing")
	if _, res := j.run(t); res.Copied != 2 {
		t.Fatalf("new files on the source did not travel: %d copied", res.Copied)
	}

	// An edit on the far side is overwritten with the source's version.
	write(t, j.right, "from-the-source.txt", "written on the right, which does not decide")
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

	// A deletion on the far side is restored from the source.
	if err := os.Remove(filepath.Join(j.right, "from-the-source.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := j.run(t); res.Copied != 1 || res.Trashed != 0 {
		t.Fatalf("a deletion on the destination did not come back: %d copied, %d trashed", res.Copied, res.Trashed)
	}
	if _, err := os.Stat(filepath.Join(j.left, "from-the-source.txt")); err != nil {
		t.Errorf("the file was removed from the source: %v", err)
	}

	// A deletion on the source leaves the destination's copy alone.
	if err := os.Remove(filepath.Join(j.left, "from-the-source.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := j.run(t); res.Trashed != 0 {
		t.Fatalf("a deletion on the source removed the destination's copy: %d trashed", res.Trashed)
	}
	if got := readFile(t, j.right, "from-the-source.txt"); got != "written on the left" {
		t.Errorf("the destination's copy changed: %q", got)
	}

	if p, res := j.run(t); len(p.Actions) != 0 || res.Copied != 0 {
		t.Fatalf("the one-way job did not settle: %d actions, %d copied", len(p.Actions), res.Copied)
	}
}

// Move mode archives: a file deleted on the source afterwards stays on the
// destination, which may hold its only copy.
func TestMoveKeepsTheArchiveWhenTheSourceDeletes(t *testing.T) {
	j := oneWay(t, plan.LeftToRight)
	write(t, j.left, "photo.jpg", "taken before the job was switched to move")
	write(t, j.left, "other.jpg", "keeps the side populated")
	j.run(t)

	j.opt.Compare.Mode = plan.ModeMove
	if err := os.Remove(filepath.Join(j.left, "photo.jpg")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, res := j.run(t); res.Trashed != 0 {
		t.Fatalf("a deletion on the source removed the archived copy: %d trashed", res.Trashed)
	}
	if got := readFile(t, j.right, "photo.jpg"); got != "taken before the job was switched to move" {
		t.Errorf("the archived copy changed: %q", got)
	}
}

// Copy only removes nothing for a file the source deleted and the destination
// edited either, and it stops reporting the pair once it has let go.
func TestCopyOnlyLetsGoOfAFileTheSourceDeleted(t *testing.T) {
	j := oneWay(t, plan.LeftToRight)
	write(t, j.left, "notes.txt", "first")
	write(t, j.left, "other.txt", "keeps the side populated")
	j.run(t)

	if err := os.Remove(filepath.Join(j.left, "notes.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}
	write(t, j.right, "notes.txt", "edited on the destination")
	j.run(t)

	p, res := j.run(t)
	if len(p.Actions) != 0 || res.Trashed != 0 {
		t.Fatalf("the job did not let go of the file: %+v", p.Actions)
	}
	if got := readFile(t, j.right, "notes.txt"); got != "edited on the destination" {
		t.Errorf("the destination's edit is gone: %q", got)
	}
	if _, err := os.Stat(filepath.Join(j.left, "notes.txt")); err == nil {
		t.Error("the file came back onto the source")
	}
	rows, err := j.db.All(context.Background())
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	if _, kept := rows["notes.txt"]; kept {
		t.Error("the record of a file the source deleted is still there")
	}
}

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

func TestTheOtherDirectionIsTheMirrorImage(t *testing.T) {
	j := oneWay(t, plan.RightToLeft)
	write(t, j.right, "from-the-source.txt", "written on the right")
	if _, res := j.run(t); res.Copied != 1 {
		t.Fatalf("a new file on the source did not travel: %d copied", res.Copied)
	}

	write(t, j.left, "from-the-source.txt", "written on the left, which does not decide")
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

func TestBothWaysIsUntouched(t *testing.T) {
	j := oneWay(t, plan.Both)
	write(t, j.left, "l.txt", "left")
	write(t, j.right, "r.txt", "right")
	if _, res := j.run(t); res.Copied != 2 {
		t.Fatalf("a two-way job did not carry both files: %d copied", res.Copied)
	}

	write(t, j.left, "l.txt", "changed on the left")
	time.Sleep(1100 * time.Millisecond)
	write(t, j.right, "l.txt", "changed on the right")
	if _, res := j.run(t); res.Conflicts != 1 {
		t.Fatalf("a two-way job stopped treating a disagreement as a conflict: %d conflicts", res.Conflicts)
	}
}

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

// A file gone from both sides is forgotten in either direction, so the same
// file put back on the destination later is left there like any other file the
// source does not have.
func TestOneWayForgetsAFileGoneFromBothSides(t *testing.T) {
	for _, dir := range []plan.Direction{plan.LeftToRight, plan.RightToLeft} {
		t.Run(dir.String(), func(t *testing.T) {
			j := oneWay(t, dir)
			src, dst := j.left, j.right
			if dir == plan.RightToLeft {
				src, dst = j.right, j.left
			}
			write(t, src, "gone.txt", "deleted on both sides")
			write(t, src, "other.txt", "keeps the sides populated")
			j.run(t)

			kept := filepath.Join(dst, "gone.txt")
			info, err := os.Stat(kept)
			if err != nil {
				t.Fatalf("stat: %v", err)
			}
			for _, root := range []string{src, dst} {
				if err := os.Remove(filepath.Join(root, "gone.txt")); err != nil {
					t.Fatalf("remove: %v", err)
				}
			}
			j.run(t)

			rows, err := j.db.All(context.Background())
			if err != nil {
				t.Fatalf("state: %v", err)
			}
			if _, stale := rows["gone.txt"]; stale {
				t.Fatal("the record of a file gone from both sides was kept")
			}

			write(t, dst, "gone.txt", "deleted on both sides")
			if err := os.Chtimes(kept, info.ModTime(), info.ModTime()); err != nil {
				t.Fatalf("chtimes: %v", err)
			}
			if _, res := j.run(t); res.Trashed != 0 {
				t.Fatalf("the file put back on the destination was deleted: %d trashed", res.Trashed)
			}
			if _, err := os.Stat(kept); err != nil {
				t.Errorf("the file put back on the destination is gone: %v", err)
			}
		})
	}
}

// A rename on the destination is undone the way a deletion there is: the source
// file comes back under its own name, and the job then has nothing left to do.
func TestOneWayRestoresAFileRenamedOnTheDestination(t *testing.T) {
	for _, mode := range []plan.Mode{plan.ModeSync, plan.ModeMirror} {
		t.Run(mode.String(), func(t *testing.T) {
			j := oneWay(t, plan.LeftToRight)
			j.opt.Compare.Mode = mode
			write(t, j.left, "report.txt", "the source's report")
			write(t, j.left, "other.txt", "keeps the side populated")
			j.run(t)

			if err := os.Rename(filepath.Join(j.right, "report.txt"), filepath.Join(j.right, "renamed.txt")); err != nil {
				t.Fatalf("rename: %v", err)
			}
			j.run(t)

			if got := readFile(t, j.right, "report.txt"); got != "the source's report" {
				t.Errorf("the destination holds %q under the source's name", got)
			}
			if _, err := os.Stat(filepath.Join(j.left, "renamed.txt")); err == nil {
				t.Error("the destination's rename reached the source")
			}
			if p, _ := j.run(t); len(p.Actions) != 0 {
				t.Fatalf("the job did not settle: %+v", p.Actions)
			}
		})
	}
}
