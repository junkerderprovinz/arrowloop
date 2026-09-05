package apply_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// TestConflictSurvivesACrashAtEveryStep pins the crash behaviour of the conflict
// manoeuvre at every point it can be interrupted.
//
// A run can die between any two filesystem operations: the power goes, the
// process is killed, the network drops. Resolving a conflict takes three
// operations, so there are three ways to be interrupted, and after each of them
// the NEXT run has to recover on its own without losing either version.
//
// What makes this work is not the order of the steps but the decision table: a
// crash after the first step leaves the losing side without the plain name
// while the winning side still holds its edited copy, and "deleted on one side,
// edited on the other" restores the file instead of propagating the deletion.
// This test also demands recovery in a SINGLE run, which is what separates this
// order from the alternatives that converge only after an extra round.
func TestConflictSurvivesACrashAtEveryStep(t *testing.T) {
	for crashAfter := range apply.ConflictStepCount() {
		t.Run(fmt.Sprintf("crash-after-step-%d", crashAfter+1), func(t *testing.T) {
			ctx := context.Background()
			j := newConflict(t)

			p, _, err := engine.Prepare(ctx, j.ends, j.db, j.opt)
			if err != nil {
				t.Fatalf("prepare: %v", err)
			}
			var act plan.Action
			var found bool
			for _, a := range p.Actions {
				if a.Kind == plan.Conflict {
					act, found = a, true
				}
			}
			if !found {
				t.Fatalf("expected a conflict to resolve, got %+v", p.Actions)
			}
			// Die partway through, using the engine's own steps.
			if err := apply.RunConflictPrefix(ctx, j.ends, act, "crashrun", crashAfter+1); err != nil {
				t.Fatalf("partial resolution: %v", err)
			}

			// Exactly ONE run must be enough to clean up after the crash.
			// Allowing two would hide a real difference: an order that leaves
			// the plain name still contested recovers eventually but costs an
			// extra round and an extra conflict copy every time.
			if _, _, err := engine.Once(ctx, j.ends, j.db, j.opt); err != nil {
				t.Fatalf("recovery run: %v", err)
			}

			left, right := readTree(t, j.left), readTree(t, j.right)
			if len(left) != len(right) {
				t.Fatalf("the sides did not converge: left %v, right %v", names(left), names(right))
			}
			for name, content := range left {
				if right[name] != content {
					t.Fatalf("%q differs between the sides after recovery", name)
				}
			}
			// Neither version may have been lost. Both were real edits, and a
			// conflict that quietly discards one of them is the failure this
			// whole design exists to prevent.
			for _, want := range []string{"the older text", "the newer text"} {
				var seen bool
				for _, content := range left {
					if content == want {
						seen = true
					}
				}
				if !seen {
					t.Errorf("%q was lost recovering from a crash after step %d; the side holds %v",
						want, crashAfter+1, values(left))
				}
			}
		})
	}
}

type conflictJob struct {
	left, right string
	ends        apply.Ends
	db          *state.DB
	opt         engine.Options
}

// newConflict builds a job whose two sides already disagree about one file,
// with the record saying they used to agree.
func newConflict(t *testing.T) *conflictJob {
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

	j := &conflictJob{
		left: left, right: right,
		ends: apply.Ends{Left: leftFs, Right: rightFs},
		db:   db,
		opt:  engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second}},
	}

	writeFile(t, left, "notes.txt", "the original")
	if _, _, err := engine.Once(ctx, j.ends, j.db, j.opt); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	// Two independent edits, with the right side deliberately the newer one so
	// the winner is not whichever side happens to be written first.
	writeFile(t, left, "notes.txt", "the older text")
	time.Sleep(10 * time.Millisecond)
	writeFile(t, right, "notes.txt", "the newer text")
	return j
}

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", rel, err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

func readTree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	return out
}

func names(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func values(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}
