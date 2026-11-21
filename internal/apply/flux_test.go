package apply

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"

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

// The report on a file that kept growing says how it grew, which the reader
// can hold against the file itself.
func TestAReportedFileBeingWrittenSaysHowItChanged(t *testing.T) {
	j := newCopyJob(t)
	writeAt(t, filepath.Join(j.left, "app.log"), "AAAA", j.stamp)
	j.ends.Left = growing{j.ends.Left}

	var res Result
	for range fluxPatience {
		var err error
		if res, err = j.run(context.Background(), j.copy("app.log", 4)); err != nil {
			t.Fatalf("run: %v", err)
		}
	}
	if len(res.Skipped) != 1 {
		t.Fatalf("the file is not reported: %+v", res.Skipped)
	}
	want := "While it was read its size changed from 4 to 9 bytes."
	got := res.Skipped[0].Reason
	if got.Vars["details"] != want || !strings.HasSuffix(got.Text, want) {
		t.Errorf("the report reads %q with details %q, want it to end in %q", got.Text, got.Vars["details"], want)
	}
	if got.Vars["sizeFrom"] != "4" || got.Vars["sizeTo"] != "9" || got.Vars["side"] != "left" || got.Vars["runs"] != "3" {
		t.Errorf("the report carries %v, want the sizes, the side and the runs as values of their own", got.Vars)
	}
}

// A copy that already reads differently is reported by what differs between
// the two sides, not by every fact of both.
func TestACopyThatReadsDifferentlyNamesTheChecksumsThatDiffer(t *testing.T) {
	f := newFixture(t, nil)
	f.rec.verify.RequireChecksum = true
	writeAt(t, filepath.Join(f.right, "notes.txt"), "BBBB", f.stamp)

	err := f.rec.settle(context.Background(), "notes.txt", "notes.txt", "notes.txt", true)
	var flux *inFluxError
	if !errors.As(err, &flux) {
		t.Fatalf("a copy that reads differently was not taken for one in flux: %v", err)
	}
	if !strings.HasPrefix(flux.Details, "After the copy the checksum is ") || strings.Contains(flux.Details, "size") || strings.Contains(flux.Details, "modification") {
		t.Errorf("the details read %q, want the checksums alone", flux.Details)
	}
}

func TestTheDetailsAfterACopyNameOnlyWhatTheComparisonLooksAt(t *testing.T) {
	at := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	later := time.Date(2026, 11, 20, 8, 16, 40, 0, time.UTC)
	cases := []struct {
		name        string
		left, right plan.Facts
		window      time.Duration
		want        string
		facts       []string
	}{
		{
			name:   "size and time",
			left:   plan.Facts{Size: 1048576, Mod: at},
			right:  plan.Facts{Size: 1040000, Mod: later},
			window: 2 * time.Second,
			want:   "After the copy the size is 1048576 bytes on the left and 1040000 on the right, the modification time is 2026-11-19 10:00:00 UTC on the left and 2026-11-20 08:16:40 UTC on the right.",
			facts:  []string{"leftSize", "1048576", "rightSize", "1040000", "leftTime", "2026-11-19T10:00:00Z", "rightTime", "2026-11-20T08:16:40Z"},
		},
		{
			// MEGA gives a file the moment it was uploaded, so its time says nothing.
			name:   "a side that keeps no times",
			left:   plan.Facts{Size: 1048576, Mod: at},
			right:  plan.Facts{Size: 1040000, Mod: later},
			window: rclonefs.ModTimeNotSupported,
			want:   "After the copy the size is 1048576 bytes on the left and 1040000 on the right.",
			facts:  []string{"leftSize", "1048576", "rightSize", "1040000"},
		},
		{
			name:   "checksums decide",
			left:   plan.Facts{Size: 4, Mod: at, Hash: "3f2a1b9c0d12aa77"},
			right:  plan.Facts{Size: 4, Mod: later, Hash: "9c0d3f2a1b77bb88"},
			window: 2 * time.Second,
			want:   "After the copy the checksum is 3f2a1b9c0d12 on the left and 9c0d3f2a1b77 on the right.",
			facts:  []string{"leftSum", "3f2a1b9c0d12", "rightSum", "9c0d3f2a1b77"},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, facts := afterCopy(c.left, c.right, c.window)
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
			if !slices.Equal(facts, c.facts) {
				t.Errorf("the values are %q, want %q", facts, c.facts)
			}
		})
	}
}

func TestATimeChangedWhileReadIsGivenInUTC(t *testing.T) {
	err := errors.New("can't copy - source file is being updated (mod time changed from 2026-11-20 09:15:02.5 +0100 CET to 2026-11-20 09:15:07 +0100 CET)")
	want := "While it was read its modification time changed from 2026-11-20 08:15:02.5 UTC to 2026-11-20 08:15:07 UTC."
	got, facts := whileRead(err)
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if want := []string{"timeFrom", "2026-11-20T08:15:02.5Z", "timeTo", "2026-11-20T08:15:07Z"}; !slices.Equal(facts, want) {
		t.Errorf("the values are %q, want %q", facts, want)
	}
}

func TestErrorWordsThatNameNoChangeCarryNoValues(t *testing.T) {
	err := errors.New("can't copy - source file is being updated")
	if got, facts := whileRead(err); got != err.Error() || facts != nil {
		t.Errorf("got %q with %q, want the error's own words alone", got, facts)
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

// A file appended to after rclone's last read reaches the end of the copy
// with a checksum the copy does not have. Its source changed, so it is in
// flux like a file rclone caught growing, with what changed as values.
func TestAFileAppendedToAfterItsLastReadIsInFlux(t *testing.T) {
	j := newCopyJob(t)
	path := filepath.Join(j.left, "app.log")
	writeAt(t, path, "AAAA", j.stamp)
	later := j.stamp.Add(time.Minute)
	j.ends.Left = appending{Fs: j.ends.Left, path: path, at: later}

	var res Result
	for run := 1; run <= fluxPatience; run++ {
		writeAt(t, path, "AAAA", j.stamp)
		var err error
		if res, err = j.run(context.Background(), j.copy("app.log", 4)); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		if run < fluxPatience && len(res.Skipped) != 0 {
			t.Fatalf("run %d counts the file against the run: %+v", run, res.Skipped)
		}
	}
	if len(res.Skipped) != 1 || res.Skipped[0].Reason.Code != "inFlux" {
		t.Fatalf("a file written to during its copy was recorded as %+v, wanted it in flux", res.Skipped)
	}
	got := res.Skipped[0].Reason.Vars
	want := map[string]string{"sizeFrom": "4", "sizeTo": "9", "timeFrom": moment(j.stamp), "timeTo": moment(later)}
	for name, value := range want {
		if got[name] != value {
			t.Errorf("%s is %q, want %q (all values: %v)", name, got[name], value, got)
		}
	}
	if j.recorded(t, "app.log") {
		t.Error("a row was written for a copy of a file that was still being written")
	}
}

// A copy whose checksum differs from a source nobody touched is a real
// corruption and stays a failure.
func TestACorruptedCopyOfAnUnchangedFileIsAFailure(t *testing.T) {
	j := newCopyJob(t)
	writeAt(t, filepath.Join(j.left, "notes.txt"), "AAAA", j.stamp)
	j.ends.Left = misreporting{j.ends.Left}

	res, err := j.run(context.Background(), j.copy("notes.txt", 4))
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(res.Skipped) != 1 || res.Skipped[0].Reason.Code != "stepFailed" {
		t.Fatalf("a corrupted copy was recorded as %+v, wanted one stepFailed", res.Skipped)
	}
	if said := res.Skipped[0].Reason.Vars["error"]; !strings.Contains(said, "corrupted on transfer") {
		t.Errorf("the failure says %q, want rclone's own words", said)
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

// Features drops the server-side copy, which the local backend has on macOS
// (clonefile) and which would write the file without asking Put.
func (f refusing) Features() *rclonefs.Features {
	ft := *f.Fs.Features()
	ft.Copy = nil
	return &ft
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

// appending is a source whose file gets five more bytes and a later time just
// after rclone has read it to the end, before rclone compares the checksums.
type appending struct {
	rclonefs.Fs
	path string
	at   time.Time
}

func (f appending) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	o, err := f.Fs.NewObject(ctx, remote)
	if err != nil {
		return nil, err
	}
	return appendingObject{Object: o, f: f}, nil
}

type appendingObject struct {
	rclonefs.Object
	f appending
}

func (o appendingObject) Open(context.Context, ...rclonefs.OpenOption) (io.ReadCloser, error) {
	content, err := os.ReadFile(o.f.path)
	if err != nil {
		return nil, err
	}
	return io.NopCloser(io.MultiReader(strings.NewReader(string(content)), appendAtEnd{o.f})), nil
}

type appendAtEnd struct{ f appending }

func (a appendAtEnd) Read([]byte) (int, error) {
	file, err := os.OpenFile(a.f.path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		return 0, err
	}
	if _, err := file.WriteString("BBBBB"); err != nil {
		file.Close()
		return 0, err
	}
	if err := file.Close(); err != nil {
		return 0, err
	}
	if err := os.Chtimes(a.f.path, a.f.at, a.f.at); err != nil {
		return 0, err
	}
	return 0, io.EOF
}

// misreporting is a source that gives a checksum its file does not have, so
// rclone finds the copy corrupted although the file never changed.
type misreporting struct{ rclonefs.Fs }

func (f misreporting) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	o, err := f.Fs.NewObject(ctx, remote)
	if err != nil {
		return nil, err
	}
	return misreportingObject{o}, nil
}

type misreportingObject struct{ rclonefs.Object }

func (misreportingObject) Hash(_ context.Context, ty hash.Type) (string, error) {
	if ty == hash.None {
		return "", nil
	}
	return strings.Repeat("0", hash.Width(ty, false)), nil
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
