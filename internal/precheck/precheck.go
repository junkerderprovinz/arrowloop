// Package precheck answers, before anything moves, whether a job could run.
//
// It catches what the job list does not show: a destination too full for the
// run (rclone would stop mid-transfer and leave the tree between two runs), a
// share mounted read-only, a state database that is gone, a path that no
// longer exists.
//
// It changes nothing, with two exceptions: proving a side is writable means
// writing a probe file under the reserved directory and removing it again, and
// estimating a run means listing both sides.
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

// Finding is one thing the check learned, as a code with values for the
// interface to translate and the English wording beside it (see plan.Reason).
//
// Side is "left", "right", or empty for a finding about the job as a whole.
// Fatal says whether it would stop the job running, so interfaces do not each
// keep their own list of which codes matter.
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
type Side struct {
	Path string `json:"path"`

	// Free and Total are what the backend says about itself, in bytes. Nil
	// means the backend cannot say, as with an S3 bucket; zero would mean full.
	Free  *int64 `json:"free"`
	Total *int64 `json:"total"`

	// Needed is the bytes a run started now would write to this side. Nil when
	// no plan was worked out.
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
	// be read, which is a fatal finding.
	Known *int `json:"known"`
}

// Opts is what a caller can vary about the check.
type Opts struct {
	// NoEstimate skips working out what the job would do, which lists both
	// sides and can take minutes on a large remote tree. The report then says
	// the free space was not compared.
	NoEstimate bool

	// ForceFree overrides what a side reports as its remaining room, in bytes,
	// for tests.
	ForceFree map[plan.Side]int64
}

// sides is the order every loop here goes in, so reports list findings in a
// stable order.
var sides = [...]plan.Side{plan.Left, plan.Right}

// Check works out whether one job could run right now. It never returns an
// error: everything that can go wrong is a finding about the job.
func Check(ctx context.Context, j job.Job, opt Opts) Report {
	rep := Report{Job: j.Name, Left: Side{Path: j.Left}, Right: Side{Path: j.Right}}

	// A disabled job may be half filled in.
	if j.Left == "" || j.Right == "" {
		rep.note("halfWritten", true)
		return rep.done()
	}

	settings, err := j.Options()
	if err != nil {
		rep.note("badSettings", true, "error", err.Error())
		return rep.done()
	}

	// Both sides are resolved before either is opened, as the runner does, so
	// a drive letter now given to another disk is not reported on.
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

	absent := map[plan.Side]bool{}
	for _, side := range sides {
		f := opened[side]
		if f == nil {
			continue
		}
		if _, err := f.List(ctx, ""); err != nil {
			if errors.Is(err, rclonefs.ErrorDirNotFound) {
				absent[side] = true
				// A missing side is fine for a new job, which creates it, but
				// fatal when files were recorded on it.
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
			// A one-way job never writes to its source, not even a probe.
			rep.noteSide("sideNotWritten", side, false)
			continue
		}
		if view.Free == nil {
			rep.noteSide("spaceUnknown", side, false, unknownWhy(err)...)
		}
		if absent[side] {
			// The local backend's Put creates missing parents, so a probe here
			// would create the mistyped folder.
			continue
		}
		name, wrote, err := probeWrite(ctx, f)
		switch {
		case err != nil && !wrote:
			rep.noteSide("sideReadOnly", side, true, "error", err.Error())
		case err != nil:
			rep.noteSide("probeLeftBehind", side, false, "path", name, "error", err.Error())
		}
	}

	rep.estimate(ctx, opened, db, settings, opt)
	return rep.done()
}

// record opens the job's state database, if it exists, and counts what it
// covers. state.Open would create a missing one, which a check must not do.
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
	// Counting proves the schema can be read, not only that the file opens.
	n, err := db.Count(ctx)
	if err != nil {
		db.Close()
		r.note("stateUnreadable", true, "path", path, "error", err.Error())
		return nil, 0
	}
	r.Known = &n
	return db, n
}

// estimate works out what a run would write and whether it would fit. It
// lists both sides, like a preview, and is skipped once anything fatal has
// been found.
func (r *Report) estimate(ctx context.Context, opened map[plan.Side]rclonefs.Fs, db *state.DB, settings engine.Options, opt Opts) {
	if opt.NoEstimate {
		r.note("estimateSkipped", false)
		return
	}
	if r.fatal() {
		return
	}

	if db == nil {
		// A job that has never run has an empty record; a temporary empty
		// database stands in for it without leaving a file at the job's path.
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
		// Includes the mass-delete brake and the empty-side guard, in the
		// engine's own words.
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

// wouldWrite adds up the bytes a plan would put on each side. It is a lower
// bound: some backends need the new bytes before releasing the old, and
// retries write twice. Nothing is subtracted, because a deletion is a move
// into the tree's own trash and frees no space.
func wouldWrite(p *plan.Plan) map[plan.Side]int64 {
	out := map[plan.Side]int64{plan.Left: 0, plan.Right: 0}
	for _, a := range p.Actions {
		switch a.Kind {
		case plan.Copy, plan.Relocate:
			out[a.Dst] += sizeOn(a, a.Src)
		case plan.Conflict:
			switch a.Resolve {
			// Only the losing side gains the winner's bytes; its own copy
			// goes to its trash.
			case plan.KeepLeft:
				out[plan.Right] += sizeOn(a, plan.Left)
			case plan.KeepRight:
				out[plan.Left] += sizeOn(a, plan.Right)
			default:
				// Keeping both puts each side's version on the other.
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

// room asks a side how much space it has left. A backend that cannot say, or
// a quota call that fails, answers nil rather than zero, which would mean full.
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

// unknownWhy carries the backend's error, if there was one, so a failed quota
// call reads differently from a backend without quotas.
func unknownWhy(err error) []string {
	if err == nil {
		return nil
	}
	return []string{"error", err.Error()}
}

// probeWrite proves a side can be written to, which listing it does not: a
// read-only mount, a bucket policy without put and a full disk all list fine.
// The probe goes under the reserved directory, so even one left behind is
// never synced, and carries the clock in its name so concurrent checks do not
// collide.
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

// writtenSides says which ends this job may put bytes on. A one-way job never
// writes to its source.
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

// noteSide records a finding about one end, with the side in the values as
// well so the wording and the field agree.
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

// fill substitutes {name} for the value of name.
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

// done settles the verdict. Findings is an empty list rather than nil, which
// would marshal to null.
func (r Report) done() Report {
	if r.Findings == nil {
		r.Findings = []Finding{}
	}
	r.OK = !r.fatal()
	return r
}
