package apply

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/hash"

	_ "github.com/rclone/rclone/backend/local"

	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// The checksum comparison after a write was ALREADY here before any of this.
// settle re-reads both sides, asks each for its MD5 and hands both to
// plan.Same, which compares the checksums whenever both sides can produce one
// and only falls back to size and modification time when they cannot. A
// mismatch is a DisagreementError and stops the whole run.
//
// What was missing is the difference between those two verdicts. Both were
// written down as the same word, "agreed", and the fallback is genuinely
// weaker: two different files can share a length and a timestamp. These tests
// are about that difference being visible, and about a job being able to refuse
// the weak one.

// TestAPairThatCannotBeChecksummedIsStillRecorded is the default, and it has to
// stay the default. Whole backends cannot hash: plain SFTP without a remote
// shell answers nothing at all, and refusing to record anything there would
// postpone every file on every run forever.
func TestAPairThatCannotBeChecksummedIsStillRecorded(t *testing.T) {
	f := newFixture(t, hash.ErrUnsupported)

	if err := f.rec.settle(context.Background(), "notes.txt", "notes.txt", "notes.txt"); err != nil {
		t.Fatalf("a pair that agrees on size and time was refused: %v", err)
	}
	if !f.recorded(t, "notes.txt") {
		t.Error("nothing was written down, so the next run will do the same work again")
	}
	// Silent on purpose. A backend with no checksums is a fact about the JOB,
	// true of every file in it, and one line per file would bury the run's own
	// list under thousands of copies of a sentence nobody needed twice.
	if got := f.saidAbout("notes.txt"); len(got) != 0 {
		t.Errorf("a backend that simply has no checksums produced %d lines of comment: %v", len(got), got)
	}
}

// TestAChecksumThatFailedForAnyOtherReasonIsSaidOutLoud is the case worth a
// line: not "this backend has no checksums" but "this file could not be read".
//
// The two arrived as the same empty string until the error stopped being thrown
// away, and an empty checksum is what silently drops the comparison down to a
// length and a clock reading. A side that could hash yesterday and cannot today
// is the whole reason anybody would want to know.
func TestAChecksumThatFailedForAnyOtherReasonIsSaidOutLoud(t *testing.T) {
	f := newFixture(t, errors.New("the disk returned a read error"))

	if err := f.rec.settle(context.Background(), "notes.txt", "notes.txt", "notes.txt"); err != nil {
		t.Fatalf("settle refused a pair it should have accepted: %v", err)
	}
	if !f.recorded(t, "notes.txt") {
		t.Error("the pair was not written down, and a failed checksum is not a reason to forget a file")
	}
	said := f.saidAbout("notes.txt")
	if len(said) != 1 {
		t.Fatalf("the run's list says %d things about a file it could not check: %v", len(said), said)
	}
	if said[0].Side != "right" {
		t.Errorf("the line blames the %q side, and the right side is the one that could not hash", said[0].Side)
	}
	for _, want := range []string{"size and modification time", "read error"} {
		if !strings.Contains(said[0].Note, want) {
			t.Errorf("the line does not mention %q, so it says a check was weak without saying why: %q", want, said[0].Note)
		}
	}
}

// TestRequireChecksumWithholdsTheRowRatherThanTheFile is the configurable half.
//
// The refusal must cost the copy nothing. The bytes are already across; only
// the row saying the two sides agree is withheld, so the next run looks again.
// A version of this that undid the transfer, or that stopped the run, would be
// destroying work to satisfy a preference.
func TestRequireChecksumWithholdsTheRowRatherThanTheFile(t *testing.T) {
	f := newFixture(t, hash.ErrUnsupported)
	f.rec.verify.RequireChecksum = true

	err := f.rec.settle(context.Background(), "notes.txt", "notes.txt", "notes.txt")
	var unver *UnverifiedError
	if !errors.As(err, &unver) {
		t.Fatalf("a pair that could not be checksummed was accepted anyway: %v", err)
	}
	if unver.Side != 1 {
		t.Errorf("the refusal blames side %v, and the right side is the one that cannot hash", unver.Side)
	}
	if f.recorded(t, "notes.txt") {
		t.Error("a row was written for a pair the job refused to accept, which is the one thing this setting exists to prevent")
	}
	// Not a disagreement. A disagreement means the engine's picture of the
	// tree is wrong and every further action would rest on it, so it stops the
	// run; this means one file went unproven and the run carries on.
	var dis *DisagreementError
	if errors.As(err, &dis) {
		t.Error("an unproven file stopped the whole run, which turns a preference into an outage")
	}
	// Both files are still exactly where they were.
	for _, side := range []string{f.left, f.right} {
		if _, statErr := os.Stat(filepath.Join(side, "notes.txt")); statErr != nil {
			t.Errorf("%s lost its file over a checksum it could not produce: %v", side, statErr)
		}
	}
}

// TestADisagreementNamesTheChecksums is about the message, and the message is
// the entire value of the check.
//
// The one case a checksum decides is two files of the same length written in
// the same second. In exactly that case the sizes and the times read as a
// matched pair, so a message built from those alone describes a disagreement
// that looks like agreement, and sends whoever reads it hunting for a bug in
// the comparison instead of looking at the file.
func TestADisagreementNamesTheChecksums(t *testing.T) {
	f := newFixture(t, nil)
	// Same length, and the modification times are forced to match, so size and
	// time alone cannot tell these apart. Only the checksum can.
	writeAt(t, filepath.Join(f.right, "notes.txt"), "BBBB", f.stamp)

	err := f.rec.settle(context.Background(), "notes.txt", "notes.txt", "notes.txt")
	var dis *DisagreementError
	if !errors.As(err, &dis) {
		t.Fatalf("two different files of the same size and time were recorded as agreeing: %v", err)
	}
	// The real MD5s of "AAAA" and "BBBB", written out rather than computed
	// here. A test that hashes the files itself with the same library would
	// pass just as happily on a message quoting the wrong file's checksum.
	for _, want := range []string{"098890dde069e9abad63f19a0d9e1f32", "f50881ced34c7d9e6bce100bf33dec60"} {
		if !strings.Contains(dis.Details, want) {
			t.Errorf("the message leaves out the checksum %s, so it reads as a false alarm: %s", want, dis.Details)
		}
	}
}

// TestHashOfKeepsTheReasonItCouldNotHash covers the two answers that used to
// arrive as one.
func TestHashOfKeepsTheReasonItCouldNotHash(t *testing.T) {
	ctx := context.Background()

	if _, err := hashOf(ctx, brokenObject{err: hash.ErrUnsupported}); !errors.Is(err, hash.ErrUnsupported) {
		t.Errorf("a backend with no checksums reported %v", err)
	}

	boom := errors.New("read error")
	if _, err := hashOf(ctx, brokenObject{err: boom}); !errors.Is(err, boom) {
		t.Errorf("a real read failure was reported as %v, losing the only useful part", err)
	}

	// A backend can answer successfully with nothing at all, for an object it
	// was never told the checksum of. That is the unsupported case wearing
	// different clothes, and returning it as a success would have the caller
	// believe it holds a checksum equal to every other empty one.
	if _, err := hashOf(ctx, brokenObject{}); !errors.Is(err, hash.ErrUnsupported) {
		t.Errorf("an empty checksum reported as a success: %v", err)
	}
}

// brokenObject is an rclone object that answers only the one question hashOf
// asks. Everything else is left nil deliberately: a call to any other method
// panics loudly rather than quietly returning a zero value, so this cannot grow
// into a fake filesystem by accident.
type brokenObject struct {
	rclonefs.Object
	err error
}

func (o brokenObject) Hash(context.Context, hash.Type) (string, error) { return "", o.err }

// hashless wraps a real filesystem and takes its checksums away.
//
// This is not an imitation of an awkward backend, it is what one is: an SFTP
// host with no remote shell lists files, reads them, has sizes and times, and
// answers nothing when asked for a checksum. Everything else is delegated to a
// real local filesystem, so the files, the sizes and the times under test are
// genuine.
type hashless struct {
	rclonefs.Fs
	err error
}

func (f hashless) Hashes() hash.Set { return hash.NewHashSet() }

func (f hashless) NewObject(ctx context.Context, remote string) (rclonefs.Object, error) {
	o, err := f.Fs.NewObject(ctx, remote)
	if err != nil {
		return nil, err
	}
	return hashlessObject{Object: o, err: f.err}, nil
}

type hashlessObject struct {
	rclonefs.Object
	err error
}

func (o hashlessObject) Hash(context.Context, hash.Type) (string, error) { return "", o.err }

type fixture struct {
	left, right string
	rec         recorder
	db          *state.DB
	stamp       time.Time

	said []Entry
}

// newFixture builds two real sides holding the same file, with the right side's
// checksums taken away when hashErr is set.
func newFixture(t *testing.T, hashErr error) *fixture {
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

	// One instant for both sides. The fallback comparison is size plus a time
	// window, and a fixture whose two files were written a few milliseconds
	// apart would be testing the window rather than the checksum.
	stamp := time.Now().Add(-time.Hour).Truncate(time.Second)
	writeAt(t, filepath.Join(left, "notes.txt"), "AAAA", stamp)
	writeAt(t, filepath.Join(right, "notes.txt"), "AAAA", stamp)

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

	f := &fixture{left: left, right: right, db: db, stamp: stamp}

	var rightSide rclonefs.Fs = rightFs
	if hashErr != nil {
		rightSide = hashless{Fs: rightFs, err: hashErr}
	}
	f.rec = recorder{
		ends:   Ends{Left: leftFs, Right: rightSide},
		db:     db,
		window: 2 * time.Second,
		observe: func(kind, path, side, note string) {
			f.said = append(f.said, Entry{Kind: kind, Side: side, Path: path, Note: note})
		},
	}
	return f
}

func (f *fixture) saidAbout(path string) []Entry {
	var out []Entry
	for _, e := range f.said {
		if e.Path == path {
			out = append(out, e)
		}
	}
	return out
}

func (f *fixture) recorded(t *testing.T, key string) bool {
	t.Helper()
	all, err := f.db.All(context.Background())
	if err != nil {
		t.Fatalf("reading the record back: %v", err)
	}
	_, ok := all[key]
	return ok
}

func writeAt(t *testing.T, path, content string, stamp time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatalf("stamp %s: %v", path, err)
	}
}
