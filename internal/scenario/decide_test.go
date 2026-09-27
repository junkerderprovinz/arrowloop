package scenario

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/trash"
)

// keptBoth syncs notes.txt once, edits it on both sides with the left edit an
// hour older, and syncs again, so a run keeps both versions: the right one
// under the plain name, the left one beside it.
func keptBoth(t *testing.T) *job {
	t.Helper()
	j := newJob(t, quick())
	write(t, j.left, "docs/notes.txt", "the original")
	j.sync(t)

	write(t, j.left, "docs/notes.txt", "edited on the left")
	write(t, j.right, "docs/notes.txt", "edited on the right")
	hourAgo := time.Now().Add(-time.Hour)
	if err := os.Chtimes(filepath.Join(j.left, "docs", "notes.txt"), hourAgo, hourAgo); err != nil {
		t.Fatalf("age the left edit: %v", err)
	}
	if _, res := j.sync(t); res.Conflicts != 1 {
		t.Fatalf("expected the run to meet one conflict, got %d", res.Conflicts)
	}
	return j
}

func openConflicts(t *testing.T, j *job) []apply.Open {
	t.Helper()
	open, err := engine.Conflicts(context.Background(), j.ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("list the conflicts: %v", err)
	}
	return open
}

func decide(t *testing.T, j *job, d apply.Decision) apply.Result {
	t.Helper()
	res, err := engine.Decide(context.Background(), j.ends, j.db, []apply.Decision{d}, j.opt, nil)
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	return res
}

func fileText(t *testing.T, root, rel string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(body)
}

// setAside lists what a conflict left beside the plain file on one side.
func setAside(t *testing.T, root string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(root, "docs"))
	if err != nil {
		t.Fatalf("read %s: %v", root, err)
	}
	var out []string
	for _, e := range entries {
		if strings.Contains(e.Name(), ".conflict-") {
			out = append(out, e.Name())
		}
	}
	return out
}

func trashed(t *testing.T, j *job, side plan.Side) []string {
	t.Helper()
	f := j.ends.Left
	root := j.left
	if side == plan.Right {
		f, root = j.ends.Right, j.right
	}
	entries, err := trash.List(context.Background(), f, trash.Trash)
	if err != nil {
		t.Fatalf("list the trash: %v", err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, fileText(t, root, e.Remote))
	}
	return out
}

// quiet requires a normal run after a decision to find nothing left to do.
func quiet(t *testing.T, j *job) {
	t.Helper()
	p, res := j.sync(t)
	if len(p.Actions) != 0 || res.Conflicts != 0 {
		t.Fatalf("the run after the decision still had work: %d actions, %d conflicts", len(p.Actions), res.Conflicts)
	}
	requireConverged(t, j, "after deciding")
}

func TestAKeptBothConflictIsListedWithBothVersions(t *testing.T) {
	j := keptBoth(t)
	open := openConflicts(t, j)
	if len(open) != 1 {
		t.Fatalf("expected one open conflict, got %+v", open)
	}
	c := open[0]
	if c.Plain != "docs/notes.txt" || c.Side != plan.Left {
		t.Fatalf("the conflict names the wrong file or side: %+v", c)
	}
	if c.Left.Path != c.Copy || c.Right.Path != "docs/notes.txt" {
		t.Errorf("each side should show the version that came from it: left %q, right %q", c.Left.Path, c.Right.Path)
	}
	if !c.Right.Mod.After(c.Left.Mod) {
		t.Errorf("the right version is the newer one, got left %s and right %s", c.Left.Mod, c.Right.Mod)
	}
	if c.Left.Size != int64(len("edited on the left")) {
		t.Errorf("the left version's size is %d", c.Left.Size)
	}
}

func TestChoosingTheSetAsideVersionPutsItUnderThePlainName(t *testing.T) {
	j := keptBoth(t)
	c := openConflicts(t, j)[0]

	res := decide(t, j, apply.Decision{Copy: c.Copy, Keep: plan.KeepLeft})
	if len(res.Skipped) != 0 {
		t.Fatalf("the decision was skipped: %+v", res.Skipped)
	}
	for _, root := range []string{j.left, j.right} {
		if got := fileText(t, root, "docs/notes.txt"); got != "edited on the left" {
			t.Errorf("%s holds %q under the plain name", root, got)
		}
		if left := setAside(t, root); len(left) != 0 {
			t.Errorf("%s still holds the set-aside copy %v", root, left)
		}
	}
	for _, side := range []plan.Side{plan.Left, plan.Right} {
		if got := trashed(t, j, side); len(got) != 1 || got[0] != "edited on the right" {
			t.Errorf("the %s trash should hold the version that lost, got %q", side, got)
		}
	}
	if open := openConflicts(t, j); len(open) != 0 {
		t.Errorf("a decided conflict is still listed: %+v", open)
	}
	quiet(t, j)
}

func TestChoosingThePlainVersionBinsTheCopy(t *testing.T) {
	j := keptBoth(t)
	c := openConflicts(t, j)[0]

	decide(t, j, apply.Decision{Copy: c.Copy, Keep: plan.KeepRight})
	for _, root := range []string{j.left, j.right} {
		if got := fileText(t, root, "docs/notes.txt"); got != "edited on the right" {
			t.Errorf("%s holds %q under the plain name", root, got)
		}
		if left := setAside(t, root); len(left) != 0 {
			t.Errorf("%s still holds the set-aside copy %v", root, left)
		}
	}
	for _, side := range []plan.Side{plan.Left, plan.Right} {
		if got := trashed(t, j, side); len(got) != 1 || got[0] != "edited on the left" {
			t.Errorf("the %s trash should hold the version that lost, got %q", side, got)
		}
	}
	quiet(t, j)
}

func TestKeepingBothLeavesTheFilesAndStopsAsking(t *testing.T) {
	j := keptBoth(t)
	c := openConflicts(t, j)[0]

	res := decide(t, j, apply.Decision{Copy: c.Copy, Keep: plan.KeepBoth})
	if res.Trashed != 0 || res.Moved != 0 {
		t.Fatalf("keeping both touched files: %+v", res)
	}
	for _, root := range []string{j.left, j.right} {
		if left := setAside(t, root); len(left) != 1 {
			t.Errorf("%s should still hold the copy, got %v", root, left)
		}
	}
	if open := openConflicts(t, j); len(open) != 0 {
		t.Errorf("a conflict somebody chose to keep is still listed: %+v", open)
	}
	quiet(t, j)
}

func TestACopyDeletedByHandDropsOffTheList(t *testing.T) {
	j := keptBoth(t)
	c := openConflicts(t, j)[0]
	if err := os.Remove(filepath.Join(j.right, filepath.FromSlash(c.Copy))); err != nil {
		t.Fatalf("remove the copy: %v", err)
	}
	if open := openConflicts(t, j); len(open) != 0 {
		t.Fatalf("a conflict with its copy gone is still listed: %+v", open)
	}

	res := decide(t, j, apply.Decision{Copy: c.Copy, Keep: plan.KeepLeft})
	if len(res.Skipped) != 1 || res.Skipped[0].Reason.Code != "conflictGone" {
		t.Fatalf("deciding a vanished conflict should be skipped as gone, got %+v", res.Skipped)
	}
	if got := fileText(t, j.left, "docs/notes.txt"); got != "edited on the right" {
		t.Errorf("a skipped decision changed the plain file to %q", got)
	}
}
