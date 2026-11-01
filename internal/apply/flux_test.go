package apply

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// A file the source loses between the scan and the copy, such as a rotated log,
// is noted as gone and does not count against the run.
func TestAFileTheSourceLostIsNotedAndNotCountedAgainstTheRun(t *testing.T) {
	j := newCopyJob(t)
	// Scanned, and gone before the copy.
	res, err := j.run(context.Background(), j.copy("rotated.log", 12))
	if err != nil {
		t.Fatalf("a file that disappeared stopped the run: %v", err)
	}
	if len(res.Skipped) != 0 {
		t.Errorf("the run counts %d files as left for later, so it turns yellow over a file that is simply gone: %+v", len(res.Skipped), res.Skipped)
	}
	if got := j.entry(res, "rotated.log"); got.Kind != NoteVanished || got.Side != "left" {
		t.Errorf("the log says %+v about the file, wanted it noted as vanished on the left", got)
	}
}

// A destination that refuses a file is a real failure and stays one.
func TestADestinationThatRefusesAFileIsStillAFailure(t *testing.T) {
	j := newCopyJob(t)
	writeAt(t, filepath.Join(j.left, "notes.txt"), "AAAA", j.stamp)
	j.ends.Right = refusing{j.ends.Right}

	res, err := j.run(context.Background(), j.copy("notes.txt", 4))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(res.Skipped) != 1 || res.Skipped[0].Reason.Code != "stepFailed" {
		t.Errorf("a refused copy was recorded as %+v, wanted one stepFailed", res.Skipped)
	}
}

// rclone stops a copy when the source grows underneath it. The run goes on,
// writes no row and stays quiet until the file has done so for three runs in a
// row.
func TestAFileBeingWrittenIsQuietForTwoRunsAndReportedOnTheThird(t *testing.T) {
	j := newCopyJob(t)
	writeAt(t, filepath.Join(j.left, "app.log"), "AAAA", j.stamp)
	j.ends.Left = growing{j.ends.Left}

	for run := 1; run <= 3; run++ {
		res, err := j.run(context.Background(), j.copy("app.log", 4))
		if err != nil {
			t.Fatalf("run %d: a file that was being written stopped the run: %v", run, err)
		}
		if j.recorded(t, "app.log") {
			t.Fatalf("run %d wrote a row for a copy that never finished", run)
		}
		if run < fluxPatience && len(res.Skipped) != 0 {
			t.Errorf("run %d already counts the file against the run: %+v", run, res.Skipped)
		}
		if run == fluxPatience && (len(res.Skipped) != 1 || res.Skipped[0].Reason.Code != "inFlux") {
			t.Errorf("after %d runs in a row the file is still not reported: %+v", run, res.Skipped)
		}
	}
}

// A file that reads differently once it is copied was written to meanwhile.
// That says nothing about the engine, so it does not stop the run, and the row
// is still withheld.
func TestAFileThatChangedWhileItWasSentDoesNotStopTheRun(t *testing.T) {
	j := newCopyJob(t)
	writeAt(t, filepath.Join(j.left, "session.jsonl"), "AAAA", j.stamp)
	j.ends.Left = rewritten{Fs: j.ends.Left, dir: j.left, stamp: j.stamp, reads: new(int)}

	res, err := j.run(context.Background(), j.copy("session.jsonl", 4))
	var dis *DisagreementError
	if errors.As(err, &dis) {
		t.Fatalf("a file written to during its copy stopped the whole run: %v", err)
	}
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(res.Skipped) != 0 {
		t.Errorf("the first time already counts against the run: %+v", res.Skipped)
	}
	if j.recorded(t, "session.jsonl") {
		t.Error("a row was written for a pair that does not agree")
	}
}

// A pair nothing touched that still disagrees means the engine's picture is
// wrong, and that stays fatal.
func TestADisagreementOnAPairNothingTouchedStillStopsTheRun(t *testing.T) {
	f := newFixture(t, nil)
	f.rec.verify.RequireChecksum = true
	writeAt(t, filepath.Join(f.right, "notes.txt"), "BBBB", f.stamp)

	err := f.rec.settle(context.Background(), "notes.txt", "notes.txt", "notes.txt", false)
	var dis *DisagreementError
	if !errors.As(err, &dis) {
		t.Fatalf("an untouched pair that disagrees was let through: %v", err)
	}
}

// A copy that lands ends the count, so a file that settles starts from nothing
// the next time it is caught being written.
func TestAFinishedCopyEndsTheCount(t *testing.T) {
	ctx := context.Background()
	db, err := state.Open(ctx, filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("state: %v", err)
	}
	defer db.Close()
	for want := 1; want <= 2; want++ {
		if got, err := db.InFlux(ctx, "app.log", nil); err != nil || got != want {
			t.Fatalf("run %d counted %d (%v)", want, got, err)
		}
	}
	if err := db.Put(ctx, state.Entry{Path: "app.log"}); err != nil {
		t.Fatalf("put: %v", err)
	}
	if got, _ := db.InFlux(ctx, "app.log", nil); got != 1 {
		t.Errorf("after a finished copy the count goes on at %d, wanted it to start again", got)
	}
}

type copyJob struct {
	left, right string
	ends        Ends
	db          *state.DB
	stamp       time.Time
}

func newCopyJob(t *testing.T) *copyJob {
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
	return &copyJob{
		left: left, right: right,
		ends:  Ends{Left: leftFs, Right: rightFs},
		db:    db,
		stamp: time.Now().Add(-time.Hour).Truncate(time.Second),
	}
}

// copy is a plan that sends one new file from the left to the right, as the
// scan saw it.
func (j *copyJob) copy(name string, size int64) *plan.Plan {
	return &plan.Plan{Actions: []plan.Action{{
		Kind: plan.Copy, Path: name, Src: plan.Left, Dst: plan.Right, SrcPath: name, DstPath: name,
		LeftNow: &scan.Entry{Path: name, Size: size, Mod: j.stamp},
	}}}
}

func (j *copyJob) run(ctx context.Context, p *plan.Plan) (Result, error) {
	return Run(ctx, j.ends, j.db, p, plan.Options{ModWindow: 2 * time.Second, Transfers: 1})
}

func (j *copyJob) entry(res Result, path string) Entry {
	for _, e := range res.Entries {
		if e.Path == path {
			return e
		}
	}
	return Entry{}
}

func (j *copyJob) recorded(t *testing.T, key string) bool {
	t.Helper()
	_, ok, err := j.db.Get(context.Background(), key)
	if err != nil {
		t.Fatalf("reading the record back: %v", err)
	}
	return ok
}

// refusing is a destination that turns every write down.
type refusing struct{ rclonefs.Fs }

func (refusing) Put(context.Context, io.Reader, rclonefs.ObjectInfo, ...rclonefs.OpenOption) (rclonefs.Object, error) {
	return nil, errors.New("permission denied")
}

// growing is a source whose files grow while they are read, which rclone's
// local backend reports in these words.
type growing struct{ rclonefs.Fs }

func (f growing) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	o, err := f.Fs.NewObject(ctx, remote)
	if err != nil {
		return nil, err
	}
	return growingObject{o}, nil
}

type growingObject struct{ rclonefs.Object }

func (growingObject) Open(context.Context, ...rclonefs.OpenOption) (io.ReadCloser, error) {
	return io.NopCloser(failingReader{}), nil
}

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) {
	return 0, errors.New("can't copy - source file is being updated (size changed from 4 to 9)")
}

// rewritten is a source whose file is written to once it has been copied, at
// the same length and in the same second, as a session log can be. rclone
// reads the source once to copy it and the run reads it again to record the
// pair, and the write lands in between.
type rewritten struct {
	rclonefs.Fs
	dir   string
	stamp time.Time
	reads *int
}

func (f rewritten) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	*f.reads++
	if *f.reads == 2 {
		full := filepath.Join(f.dir, filepath.FromSlash(remote))
		if err := os.WriteFile(full, []byte("BBBB"), 0o644); err != nil {
			return nil, err
		}
		if err := os.Chtimes(full, f.stamp, f.stamp); err != nil {
			return nil, err
		}
	}
	return f.Fs.NewObject(ctx, remote)
}
