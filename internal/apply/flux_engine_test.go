package apply_test

import (
	"context"
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

// A copy that met its source being written leaves its own version on the far
// side. The next run sends the source again instead of taking the two
// versions for a conflict, on a job that syncs both ways.
func TestAFileLeftInFluxIsSentAgainWithoutAConflict(t *testing.T) {
	j := newFluxJob(t)
	j.copyWhileWritten(t)

	_, res, err := engine.Once(context.Background(), j.ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("run after the file settled: %v", err)
	}
	if res.Conflicts != 0 {
		t.Errorf("the run took the copy it had left behind for a conflict: %+v", res.Entries)
	}
	if got := read(t, filepath.Join(j.right, "session.jsonl")); got != "DDDD" {
		t.Errorf("the far side holds %q, wanted the source as it settled", got)
	}
	if _, ok, _ := j.db.Get(context.Background(), "session.jsonl"); !ok {
		t.Error("the pair was sent and still has no record")
	}
}

// What the copy left is only trusted while the far side still holds it. An
// edit made there since is a conflict, as it would be after any other run.
func TestAFarSideEditedAfterAFileInFluxIsStillAConflict(t *testing.T) {
	j := newFluxJob(t)
	j.copyWhileWritten(t)
	stamp(t, filepath.Join(j.right, "session.jsonl"), "an edit made on the far side", j.when.Add(time.Hour))

	_, res, err := engine.Once(context.Background(), j.ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Conflicts != 1 {
		t.Errorf("an edit on the far side was overwritten without a conflict: %+v", res.Entries)
	}
}

type fluxJob struct {
	left, right string
	ends        apply.Ends
	db          *state.DB
	opt         engine.Options
	when        time.Time
}

// newFluxJob builds two sides that agree about one file.
func newFluxJob(t *testing.T) *fluxJob {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	j := &fluxJob{
		left:  filepath.Join(root, "left"),
		right: filepath.Join(root, "right"),
		when:  time.Now().Add(-time.Hour).Truncate(time.Second),
		opt:   engine.Options{Compare: plan.Options{ModWindow: 2 * time.Second}},
	}
	for _, d := range []string{j.left, j.right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	leftFs, err := rclonefs.NewFs(ctx, j.left)
	if err != nil {
		t.Fatalf("left fs: %v", err)
	}
	rightFs, err := rclonefs.NewFs(ctx, j.right)
	if err != nil {
		t.Fatalf("right fs: %v", err)
	}
	j.ends = apply.Ends{Left: leftFs, Right: rightFs}
	if j.db, err = state.Open(ctx, filepath.Join(root, "state.db")); err != nil {
		t.Fatalf("state: %v", err)
	}
	t.Cleanup(func() { j.db.Close() })

	stamp(t, filepath.Join(j.left, "session.jsonl"), "AAAA", j.when.Add(-time.Hour))
	if _, _, err := engine.Once(ctx, j.ends, j.db, j.opt); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	return j
}

// copyWhileWritten edits the file on the left and runs once while the source
// is written to between the copy and the check, at the same length and in the
// same second, so the copy is left behind without a record.
func (j *fluxJob) copyWhileWritten(t *testing.T) {
	t.Helper()
	stamp(t, filepath.Join(j.left, "session.jsonl"), "CCCC", j.when)
	ends := apply.Ends{Left: writtenMeanwhile{Fs: j.ends.Left, dir: j.left, when: j.when, reads: new(int)}, Right: j.ends.Right}
	_, res, err := engine.Once(context.Background(), ends, j.db, j.opt)
	if err != nil {
		t.Fatalf("a file written to during its copy stopped the run: %v", err)
	}
	if len(res.Skipped) != 0 {
		t.Fatalf("the first run in flux already counts against the run: %+v", res.Skipped)
	}
	if got := read(t, filepath.Join(j.right, "session.jsonl")); got != "CCCC" {
		t.Fatalf("the copy left %q on the far side, so this test sets up nothing", got)
	}
}

// writtenMeanwhile rewrites its file on the second lookup, which is the run
// reading the source again to record the pair after rclone has copied it.
type writtenMeanwhile struct {
	rclonefs.Fs
	dir   string
	when  time.Time
	reads *int
}

func (f writtenMeanwhile) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	*f.reads++
	if *f.reads == 2 {
		if err := writeStamped(filepath.Join(f.dir, filepath.FromSlash(remote)), "DDDD", f.when); err != nil {
			return nil, err
		}
	}
	return f.Fs.NewObject(ctx, remote)
}

func stamp(t *testing.T, path, content string, when time.Time) {
	t.Helper()
	if err := writeStamped(path, content, when); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func writeStamped(path, content string, when time.Time) error {
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return err
	}
	return os.Chtimes(path, when, when)
}

func read(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}
