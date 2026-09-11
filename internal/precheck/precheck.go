// Package precheck answers, before anything moves, whether a job could run.
//
// Two quiet failures are the reason it exists.
//
// The first is a run that fills the destination. rclone stops mid-transfer with
// an out-of-space error, which reads like an ordinary failure and is not one:
// the files that did land have their state rows written, the file that was half
// written has none, and the tree is left in a condition whose only honest
// description is "somewhere between the last two runs". The disk was already
// too full before the first byte moved, and nothing asked it.
//
// The second is everything a person cannot see from the job list. A share
// mounted read-only, a state database on a disk that has since been swapped, a
// path that was right last month: each of those looks exactly like a healthy
// job until three in the morning, when the run that was supposed to happen does
// not. This package is the one button that asks all of it at once.
//
// Nothing here changes anything, with two deliberate exceptions, and both are
// written down where they happen: proving a side is writable means writing to
// it, and working out how many bytes a run would move means listing both sides.
// The probe goes under the tool's own reserved directory, which the scanner
// skips, and it is removed again.
package precheck

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/object"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// Finding is one thing the check learned, in the shape plan.Reason established.
//
// A code and its values rather than a sentence, because the interface
// translates and this engine has no business knowing which language somebody
// reads. The English wording travels alongside for a reader that has never
// heard of the code: an untranslated explanation is worth more than a blank.
//
// Side is "left", "right", or empty for a finding about the job as a whole.
// Fatal says whether this one thing would stop the job running, which is the
// judgement a screen must not have to make for itself: a list of codes with no
// severity forces every interface to keep its own copy of which ones matter,
// and those copies drift.
type Finding struct {
	Code  string            `json:"code"`
	Side  string            `json:"side,omitempty"`
	Vars  map[string]string `json:"vars,omitempty"`
	Text  string            `json:"text"`
	Fatal bool              `json:"fatal"`
}

// findingText is the English wording of every finding this package gives. An
// interface carries the same set keyed by the same codes.
var findingText = map[string]string{
	"halfWritten":     "this job has not been given both sides yet",
	"badSettings":     "this job's own settings cannot be read: {error}",
	"volumeMissing":   "the drive the {side} side lives on is not attached: {volume}",
	"sideUnreachable": "the {side} side could not be opened: {error}",
	"sideMissing":     "the {side} side is not there at all, and {known} files were recorded on it last time",
	"sideNew":         "the {side} side does not exist yet, so the first run would create it",
	"stateNew":        "the state database at {path} has not been made yet, so this job has never run",
	"stateUnreadable": "the state database at {path} cannot be read: {error}",
	"sideReadOnly":    "the {side} side refused a test file, so this job cannot write to it: {error}",
	"probeLeftBehind": "a test file was written to the {side} side and could not be removed again: {path}",
	"sideNotWritten":  "this job never writes to the {side} side, so nothing was written there to prove it could be",
	"spaceUnknown":    "the {side} side cannot say how much room it has left",
	"planFailed":      "working out what this job would do failed: {error}",
	"notEnoughSpace":  "the {side} side reports {free} bytes free and this job would write at least {needed}",
	"estimateSkipped": "the free space check was skipped, so nothing was measured against what the sides have left",
}

// Side is what one end of the job reported about itself.
//
// Free, Total and Needed are pointers because "unknown" is a real answer and
// zero is a different real answer. An S3 bucket has no size, so it cannot say
// how much room is left; reporting that as zero would mean "full", and every
// job pointed at a bucket would be refused. The distinction is the whole reason
// these are not plain numbers.
type Side struct {
	Path string `json:"path"`

	// Free and Total are what the backend says about itself, in bytes. Nil
	// means the backend cannot say, which is not a fault.
	Free  *int64 `json:"free"`
	Total *int64 `json:"total"`

	// Needed is the bytes a run started now would write to this side. Nil when
	// no plan was worked out, either because the caller asked for none or
	// because something fatal made planning pointless.
	Needed *int64 `json:"needed"`

	// Written says whether this job writes to this side at all. A one-way job
	// never touches its source, so neither the write probe nor the space
	// comparison applies there.
	Written bool `json:"written"`
}

// Report is everything one check learned about one job.
type Report struct {
	Job      string    `json:"job"`
	OK       bool      `json:"ok"`
	Findings []Finding `json:"findings"`
	Left     Side      `json:"left"`
	Right    Side      `json:"right"`

	// Known is how many files the state database covers. Nil when it could not
	// be read, which is itself a fatal finding: without the record a two-way
	// job cannot tell a new file from a deleted one.
	Known *int `json:"known"`
}

// Opts is what a caller can vary about the check.
type Opts struct {
	// NoEstimate skips working out what the job would do.
	//
	// That estimate is a full listing of both sides, which is the same work a
	// preview does: minutes on a large tree over SFTP. Somebody who only wants
	// to know whether their share is mounted should not have to wait for it.
	// Without the estimate there is nothing to compare the free space against,
	// and the report says so rather than quietly reporting room to spare.
	NoEstimate bool

	// ForceFree overrides what a side reports as its remaining room, in bytes.
	// Only the tests need it: a disk with a hundred bytes left is an ordinary
	// state of a real disk, and there is no portable way to stand in one, so
	// the number is said out loud instead of being manufactured.
	ForceFree map[plan.Side]int64
}

// sides is the order every loop here goes in, so that a report reads the same
// way twice and a screen does not reshuffle its own list between two checks.
var sides = [...]plan.Side{plan.Left, plan.Right}

// Check works out whether one job could run right now.
//
// It never returns an error. Every way this can go wrong is a fact about the
// job rather than a fault of the request, and the caller asked precisely to be
// told those facts: a check that answered "error" for an unplugged drive would
// be hiding its own answer.
func Check(ctx context.Context, j job.Job, opt Opts) Report {
	rep := Report{Job: j.Name, Left: Side{Path: j.Left}, Right: Side{Path: j.Right}}

	// A job that is switched off is allowed to be half written, which is the
	// state of every job between being created and being filled in. Checking
	// one has to say so plainly rather than handing an empty string to a
	// backend and reporting whatever that backend makes of it.
	if j.Left == "" || j.Right == "" {
		rep.note("halfWritten", true)
		return rep.done()
	}

	settings, err := j.Options()
	if err != nil {
		rep.note("badSettings", true, "error", err.Error())
		return rep.done()
	}

	// Both sides are resolved before either is opened, for the reason the
	// runner resolves them first: a drive letter that has since been handed to
	// a different disk is not empty, and a check that opened it would report
	// confidently about the wrong volume.
	paths := map[plan.Side]string{}
	for _, side := range sides {
		resolved, err := volume.Resolve(sideOf(j, side))
		if err != nil {
			rep.noteSide("volumeMissing", side, true, "volume", volume.Describe(sideOf(j, side)))
			continue
		}
		paths[side] = resolved
	}
	if len(paths) < len(sides) {
		return rep.done()
	}

	opened := map[plan.Side]rclonefs.Fs{}
	for _, side := range sides {
		f, err := rclonefs.NewFs(ctx, paths[side])
		if err != nil {
			rep.noteSide("sideUnreachable", side, true, "error", err.Error())
			continue
		}
		opened[side] = f
	}

	db, known := rep.record(ctx, j.State)
	if db != nil {
		defer db.Close()
	}

	// A side that is not there is found here and remembered, because it changes
	// what may be done to it afterwards.
	absent := map[plan.Side]bool{}
	for _, side := range sides {
		f := opened[side]
		if f == nil {
			continue
		}
		if _, err := f.List(ctx, ""); err != nil {
			if errors.Is(err, rclonefs.ErrorDirNotFound) {
				absent[side] = true
				// A side that never held anything and is not there yet is an
				// ordinary new job: the first run creates it. A side that used
				// to hold files and is not there now is the classic total loss
				// waiting to happen, and it is the single most valuable thing
				// this check can say out loud.
				if known > 0 {
					rep.noteSide("sideMissing", side, true, "known", strconv.Itoa(known))
					continue
				}
				rep.noteSide("sideNew", side, false)
				continue
			}
			rep.noteSide("sideUnreachable", side, true, "error", err.Error())
		}
	}

	written := writtenSides(settings.Compare.Direction)
	for _, side := range sides {
		view := rep.at(side)
		view.Written = written[side]
		f := opened[side]
		if f == nil {
			continue
		}

		free, total, err := room(ctx, f)
		if forced, ok := opt.ForceFree[side]; ok {
			free = &forced
		}
		view.Free, view.Total = free, total

		if !written[side] {
			// A one-way job promises never to touch its source. Writing a probe
			// there to prove it could would break exactly the promise somebody
			// chose the direction for.
			rep.noteSide("sideNotWritten", side, false)
			continue
		}
		if view.Free == nil {
			// Deliberately not fatal, and deliberately reported. A bucket that
			// cannot say how full it is has not gone wrong, but a person
			// reading a green report has to know that the space question was
			// never actually answered for that side.
			rep.noteSide("spaceUnknown", side, false, unknownWhy(err)...)
		}
		if absent[side] {
			// A side that is not there is NOT probed. The local backend's Put
			// makes every missing parent including the root, so a probe here
			// would create the folder somebody mistyped and the check would
			// then report a healthy job it had just invented.
			continue
		}
		name, wrote, err := probeWrite(ctx, f)
		switch {
		case err != nil && !wrote:
			rep.noteSide("sideReadOnly", side, true, "error", err.Error())
		case err != nil:
			// The side can be written to, which is what was asked, and there is
			// now a file on it that this check put there. Saying nothing would
			// leave somebody to find it themselves.
			rep.noteSide("probeLeftBehind", side, false, "path", name, "error", err.Error())
		}
	}

	rep.estimate(ctx, opened, db, settings, opt)
	return rep.done()
}

// record opens the job's state database and counts what it covers.
//
// The database is only opened when it is already there. state.Open creates one
// otherwise, and a check is a question rather than a first run: somebody asking
// whether a job is set up correctly should not find a new file on their disk
// because they asked. A job that has never run is reported as exactly that.
func (r *Report) record(ctx context.Context, path string) (*state.DB, int) {
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.note("stateNew", false, "path", path)
			zero := 0
			r.Known = &zero
			return nil, 0
		}
		r.note("stateUnreadable", true, "path", path, "error", err.Error())
		return nil, 0
	}

	db, err := state.Open(ctx, path)
	if err != nil {
		r.note("stateUnreadable", true, "path", path, "error", err.Error())
		return nil, 0
	}
	// Counted rather than merely opened. Opening proves the file is a database;
	// only reading from it proves the schema is one this build understands, and
	// a job whose record cannot be read is a job that would treat every file on
	// both sides as brand new.
	n, err := db.Count(ctx)
	if err != nil {
		db.Close()
		r.note("stateUnreadable", true, "path", path, "error", err.Error())
		return nil, 0
	}
	r.Known = &n
	return db, n
}

// estimate works out what a run would write and whether it would fit.
//
// This is the half of the check that costs something, because there is no way
// to know how many bytes a run would move without listing both sides, which is
// exactly what a preview does. It is skipped when anything fatal has already
// been found: a side that could not be opened cannot be listed either, and
// planning would only produce a second, less useful sentence about the same
// fault.
func (r *Report) estimate(ctx context.Context, opened map[plan.Side]rclonefs.Fs, db *state.DB, settings engine.Options, opt Opts) {
	if opt.NoEstimate {
		r.note("estimateSkipped", false)
		return
	}
	if r.fatal() {
		return
	}

	if db == nil {
		// A job that has never run has an empty record, and an empty database
		// in a temporary directory IS that state rather than an approximation
		// of it. Opening the job's own path here would leave a file behind for
		// a job somebody was only asking a question about.
		scratch, err := os.MkdirTemp("", "arrowloop-precheck")
		if err != nil {
			r.note("planFailed", true, "error", err.Error())
			return
		}
		defer os.RemoveAll(scratch)
		empty, err := state.Open(ctx, filepath.Join(scratch, "state.db"))
		if err != nil {
			r.note("planFailed", true, "error", err.Error())
			return
		}
		defer empty.Close()
		db = empty
	}

	ends := apply.Ends{Left: opened[plan.Left], Right: opened[plan.Right]}
	p, _, err := engine.Prepare(engine.Configure(ctx, settings), ends, db, settings)
	if err != nil {
		// The engine's own words. A job refused by the mass-delete brake or by
		// the empty-side guard is a job that will not run tonight, and saying
		// so in the same sentence the run would use means there is one wording
		// to recognise rather than two.
		r.note("planFailed", true, "error", err.Error())
		return
	}

	would := wouldWrite(p)
	for _, side := range sides {
		view := r.at(side)
		needed := would[side]
		view.Needed = &needed
		if !view.Written || view.Free == nil {
			continue
		}
		if needed > *view.Free {
			r.noteSide("notEnoughSpace", side, true,
				"needed", strconv.FormatInt(needed, 10),
				"free", strconv.FormatInt(*view.Free, 10))
		}
	}
}

// wouldWrite adds up the bytes a plan would put on each side.
//
// It is a floor, and calling it anything else would be a lie: a copy that
// replaces a file needs the new bytes before the old ones are released on some
// backends, and a retried transfer writes the same file twice. Padding the
// number to cover that would refuse runs that would in fact have fitted, and a
// check that cries wolf is a check somebody switches off.
//
// Nothing is ever subtracted, and that is the part worth reading twice. A
// deletion in this program is a move into the tree's OWN trash, which lives
// inside the same tree: deleting a hundred gigabytes frees nothing at all, and
// a check that credited those bytes back would wave through a run that then
// filled the disk exactly as before. A rename is a rename on the far side and
// brings no new bytes either.
func wouldWrite(p *plan.Plan) map[plan.Side]int64 {
	out := map[plan.Side]int64{plan.Left: 0, plan.Right: 0}
	for _, a := range p.Actions {
		switch a.Kind {
		case plan.Copy, plan.Relocate:
			out[a.Dst] += sizeOn(a, a.Src)
		case plan.Conflict:
			switch a.Resolve {
			// A resolution somebody chose leaves one version standing on both
			// sides, so only the side that loses gains anything: the winner's
			// bytes. The loser's own copy goes to the trash inside its own
			// tree, which costs nothing new.
			case plan.KeepLeft:
				out[plan.Right] += sizeOn(a, plan.Left)
			case plan.KeepRight:
				out[plan.Left] += sizeOn(a, plan.Right)
			default:
				// Keeping both leaves each side holding the other side's
				// version beside its own, so each gains what the other has.
				// Which of the two wins the plain name is decided by
				// modification time when the run happens, and it does not
				// change the arithmetic either way.
				out[plan.Left] += sizeOn(a, plan.Right)
				out[plan.Right] += sizeOn(a, plan.Left)
			}
		case plan.Move, plan.Delete:
		}
	}
	return out
}

func sizeOn(a plan.Action, side plan.Side) int64 {
	e := a.LeftNow
	if side == plan.Right {
		e = a.RightNow
	}
	if e == nil {
		return 0
	}
	return e.Size
}

// room asks a side how much space it has left.
//
// Not every backend can answer, and the ones that cannot are not broken: an S3
// bucket has no size, so there is no number to give. That has to come back as
// "unknown" and never as zero, because zero is itself a real answer meaning
// "full", and a check that confused the two would refuse every job pointed at a
// bucket while claiming to have measured something.
//
// An error is treated the same way as an unsupported backend. A quota call that
// times out has told us nothing about the disk, and turning "I could not ask"
// into "there is no room" would stop a run that had nothing wrong with it.
func room(ctx context.Context, f rclonefs.Fs) (free, total *int64, err error) {
	features := f.Features()
	if features == nil || features.About == nil {
		return nil, nil, nil
	}
	usage, err := features.About(ctx)
	if err != nil {
		return nil, nil, err
	}
	if usage == nil {
		return nil, nil, nil
	}
	return usage.Free, usage.Total, nil
}

// unknownWhy carries the backend's own words when there were any. A quota call
// that failed and a backend that has no quota are both "unknown" and they are
// not the same thing to whoever has to fix it.
func unknownWhy(err error) []string {
	if err == nil {
		return nil
	}
	return []string{"error", err.Error()}
}

// probeWrite proves a side can be written to, which listing it does not.
//
// A share mounted read-only, a bucket policy that allows listing and not
// putting, a disk that is already full: all three list perfectly and all three
// fail on the first transfer. Asking the backend what it believes it supports
// catches none of them, because every one of those backends does support
// writing in general and is refusing this particular caller.
//
// The probe goes under the tool's own reserved directory, which the scanner
// skips on both sides. A probe that somehow survives is therefore never synced
// anywhere, which is the difference between leaving one stray file and seeding
// it into somebody's other machine. The clock is in the name so that two checks
// running at once cannot land on each other.
func probeWrite(ctx context.Context, f rclonefs.Fs) (name string, wrote bool, err error) {
	name = path.Join(scan.MetaDir, fmt.Sprintf("writable-%d.tmp", time.Now().UnixNano()))
	body := []byte("arrowloop write probe\n")
	info := object.NewStaticObjectInfo(name, time.Now(), int64(len(body)), true, nil, f)

	obj, err := f.Put(ctx, bytes.NewReader(body), info)
	if err != nil {
		return name, false, err
	}
	return name, true, obj.Remove(ctx)
}

// writtenSides says which ends this job may put bytes on. A one-way job reads
// its source and never writes to it, so a full disk on that side is not this
// job's problem and a probe there would be a broken promise.
func writtenSides(dir plan.Direction) map[plan.Side]bool {
	out := map[plan.Side]bool{plan.Left: true, plan.Right: true}
	switch dir {
	case plan.LeftToRight:
		out[plan.Left] = false
	case plan.RightToLeft:
		out[plan.Right] = false
	}
	return out
}

func sideOf(j job.Job, s plan.Side) string {
	if s == plan.Left {
		return j.Left
	}
	return j.Right
}

func (r *Report) at(s plan.Side) *Side {
	if s == plan.Left {
		return &r.Left
	}
	return &r.Right
}

// note records a finding about the job as a whole.
func (r *Report) note(code string, fatal bool, pairs ...string) {
	r.Findings = append(r.Findings, finding(code, "", fatal, pairs...))
}

// noteSide records a finding about one end, and puts the side into the values
// as well so that the wording and the machine-readable half can never disagree
// about which end is meant.
func (r *Report) noteSide(code string, s plan.Side, fatal bool, pairs ...string) {
	pairs = append(pairs, "side", s.String())
	r.Findings = append(r.Findings, finding(code, s.String(), fatal, pairs...))
}

func finding(code, side string, fatal bool, pairs ...string) Finding {
	vars := make(map[string]string, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		vars[pairs[i]] = pairs[i+1]
	}
	if len(vars) == 0 {
		vars = nil
	}
	return Finding{Code: code, Side: side, Vars: vars, Text: fill(findingText[code], vars), Fatal: fatal}
}

// fill substitutes {name} for the value of name. A code nobody has worded yet
// answers with the code itself rather than with an empty string: an interface
// that does not recognise it then shows something, which is worth more than a
// blank where an explanation should be.
func fill(template string, vars map[string]string) string {
	if template == "" {
		return ""
	}
	out := template
	for name, value := range vars {
		out = strings.ReplaceAll(out, "{"+name+"}", value)
	}
	return out
}

func (r *Report) fatal() bool {
	for _, f := range r.Findings {
		if f.Fatal {
			return true
		}
	}
	return false
}

// done settles the verdict and hands back a report that survives being encoded.
//
// The empty list rather than a nil one is not tidiness: a nil slice marshals to
// null, and a screen promised a list of findings would have to guard every use
// of it. A job with nothing wrong has no findings, not an absent field.
func (r Report) done() Report {
	if r.Findings == nil {
		r.Findings = []Finding{}
	}
	r.OK = !r.fatal()
	return r
}
