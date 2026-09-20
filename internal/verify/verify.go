// Package verify holds the record up against both sides and reports where the
// two accounts disagree.
//
// A state row says the two sides agreed on a file. When each side still
// matches its half of a row, the engine treats the file as unchanged, so a row
// claiming an agreement that never happened hides a real difference from every
// later run. The apply stage refuses to write such a row, but a record restored
// from a backup, copied to another machine, edited by hand or cut short by a
// crash bypasses that guard.
//
// The check repairs nothing, so the diagnosis can be read before anybody acts
// on it. Directories are left out: they have no content to disagree about.
package verify

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// Finding is one path where the record and the two sides do not agree. It is
// shaped like precheck.Finding, with Invisible in place of Fatal, since none of
// these findings stops a run.
type Finding struct {
	Code string `json:"code"`

	// Path is the matching key the record uses; the vars carry each side's
	// real name where it differs.
	Path string `json:"path"`

	// Side names the one end a finding is about, and is empty for a finding
	// about a path as a whole.
	Side string `json:"side,omitempty"`

	Vars map[string]string `json:"vars,omitempty"`
	Text string            `json:"text"`

	// Invisible says that no future run will notice this on its own, as with
	// a row both sides still match while they differ from each other. A file
	// the record has never heard of is not invisible, because the next run
	// writes its row.
	Invisible bool `json:"invisible"`
}

// findingText is the English wording of every finding this package gives. An
// interface carries the same set keyed by the same codes.
var findingText = map[string]string{
	"agreedButDiffer":           "the record says both sides agreed on this file, each side still matches what was recorded for it, and the two versions are not the same; no run will notice this by itself",
	"recordDisagreesWithItself": "the record's own two halves describe different files, so this row never stood for an agreement between the sides",
	"recordedButOnNeitherSide":  "the record has a row for this file and it is on neither side",
	"onBothSidesUnrecorded":     "this file is on both sides and the record has never heard of it",
	"recordedButOnOneSideOnly":  "the record says both sides held this file and only the {side} side still does",
}

// Report is everything one check learned about one job. The counts tell an
// empty report that compared everything apart from one that compared nothing.
type Report struct {
	Job string `json:"job"`

	// Checksums says whether file content was compared. See Opts.Checksums.
	Checksums bool `json:"checksums"`

	// Known is how many rows the record holds for paths this job can see,
	// LeftFiles and RightFiles what each side listed, and Checked how many
	// distinct paths were compared.
	Known      int `json:"known"`
	LeftFiles  int `json:"leftFiles"`
	RightFiles int `json:"rightFiles"`
	Checked    int `json:"checked"`

	// Collisions is how many keys were left out because one side holds two
	// files whose names the other side could not tell apart.
	Collisions int `json:"collisions"`

	// Found is how many findings the check produced and Returned how many are
	// in the list, which is bounded. Truncated saves the screen comparing them.
	Found     int  `json:"found"`
	Returned  int  `json:"returned"`
	Truncated bool `json:"truncated"`

	Findings []Finding `json:"findings"`
}

// Opts is what a caller can vary about the check.
type Opts struct {
	// Checksums compares the content of every file instead of size and
	// modification time, reading every byte of both trees.
	//
	// Without it the comparison is the engine's own rule, so it proves that no
	// run will notice a difference, but two files of the same length written
	// in the same second look equal. With it a reported difference is a real
	// one; a backend that cannot hash still falls back to size and time.
	Checksums bool

	// Limit bounds the list of findings. Zero means DefaultLimit and anything
	// above MaxLimit is cut to it. The counts always cover every finding.
	Limit int
}

// DefaultLimit and MaxLimit bound the list of findings.
const (
	DefaultLimit = 500
	MaxLimit     = 5000
)

// sides is the order every loop here goes in.
var sides = [...]plan.Side{plan.Left, plan.Right}

// Check compares both sides of one job against its record. Unlike precheck it
// returns an error when a side or the record cannot be read, since an empty
// list would then look like a clean result.
func Check(ctx context.Context, j job.Job, opt Opts) (Report, error) {
	// Findings starts as an empty list so the report returned beside an error
	// does not encode it as null.
	rep := Report{Job: j.Name, Checksums: opt.Checksums, Findings: []Finding{}}

	limit := opt.Limit
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}

	if j.Left == "" || j.Right == "" {
		return rep, errors.New("this job has not been given both sides yet, so there is nothing to compare")
	}
	settings, err := j.Options()
	if err != nil {
		return rep, fmt.Errorf("this job's own settings cannot be read: %w", err)
	}

	prev, err := recordOf(ctx, j.State)
	if err != nil {
		return rep, err
	}

	// Both sides are resolved before either is opened, as the runner does, so
	// a drive letter now given to another disk is not compared.
	ends := map[plan.Side]rclonefs.Fs{}
	for _, side := range sides {
		resolved, err := volume.Resolve(sideOf(j, side))
		if err != nil {
			return rep, fmt.Errorf("the drive the %s side lives on is not attached: %s", side, volume.Describe(sideOf(j, side)))
		}
		f, err := rclonefs.NewFs(ctx, resolved)
		if err != nil {
			return rep, fmt.Errorf("the %s side could not be opened: %w", side, err)
		}
		ends[side] = f
	}

	// Names are matched exactly as a run matches them, or files would be
	// reported missing that the engine sees fine.
	scanOpt := scan.Options{FoldCase: foldCase(ends, settings), Exclude: settings.Exclude}
	listings := map[plan.Side]*scan.Listing{}
	for _, side := range sides {
		listing, err := scan.List(ctx, ends[side], scanOpt)
		if err != nil {
			return rep, fmt.Errorf("the %s side could not be listed: %w", side, err)
		}
		listings[side] = listing
	}
	left, right := listings[plan.Left], listings[plan.Right]

	// The record is filtered as the sides are, or newly excluded paths would
	// be reported as on neither side.
	visible := make(map[string]state.Entry, len(prev))
	for key, entry := range prev {
		if settings.Exclude.Excluded(entry.LeftPath) || settings.Exclude.Excluded(entry.RightPath) || settings.Exclude.Excluded(key) {
			continue
		}
		visible[key] = entry
	}

	// A side that lists nothing while the record knows files gets the engine's
	// refusal rather than one finding per recorded path.
	if len(visible) > 0 {
		for _, side := range sides {
			if len(listings[side].Files) == 0 {
				return rep, &plan.EmptySideError{Side: side, Known: len(visible)}
			}
		}
	}

	rep.Known = len(visible)
	rep.LeftFiles = len(left.Files)
	rep.RightFiles = len(right.Files)

	// The scanner drops a colliding key from its side's listing, so its row
	// would look like a file gone from that side. The preview reports
	// collisions with both names; the count is enough here.
	blocked := map[string]bool{}
	for _, side := range sides {
		for _, c := range listings[side].Collisions {
			blocked[c.Key] = true
		}
	}
	rep.Collisions = len(blocked)

	keys := make(map[string]struct{}, len(left.Files)+len(right.Files)+len(visible))
	for _, side := range sides {
		for k := range listings[side].Files {
			keys[k] = struct{}{}
		}
	}
	for k := range visible {
		keys[k] = struct{}{}
	}

	// Sorted, so a bounded list holds the same findings on every check.
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		if blocked[k] {
			continue
		}
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)

	window := settings.Compare.ModWindow
	for _, key := range ordered {
		rep.Checked++
		row, hasRow := visible[key]
		found, ok := judge(ctx, key, left.Files[key], right.Files[key], row, hasRow, opt.Checksums, window)
		if !ok {
			continue
		}
		rep.Found++
		if len(rep.Findings) < limit {
			rep.Findings = append(rep.Findings, found)
		}
	}

	rep.Returned = len(rep.Findings)
	rep.Truncated = rep.Found > rep.Returned
	return rep, nil
}

// judge decides what one path has to say. It returns at most one finding, so
// the totals count paths.
func judge(ctx context.Context, key string, l, r *scan.Entry, row state.Entry, hasRow, checksums bool, window time.Duration) (Finding, bool) {
	onLeft, onRight := l != nil, r != nil

	switch {
	case !hasRow && onLeft && onRight:
		// Two people saving the same attachment produce this, and so does a
		// wiped or outdated record. The next run writes the row either way.
		return finding("onBothSidesUnrecorded", key, "", false), true

	case !hasRow:
		// An ordinary new file, which the preview already lists.
		return Finding{}, false

	case !onLeft && !onRight:
		return finding("recordedButOnNeitherSide", key, "", false,
			"leftPath", row.LeftPath, "rightPath", row.RightPath), true

	case !onLeft || !onRight:
		// Could be a deletion the next run will propagate or a half-mounted
		// folder; one moment cannot tell them apart.
		side := plan.Left
		if !onLeft {
			side = plan.Right
		}
		return finding("recordedButOnOneSideOnly", key, side.String(), false, "side", side.String()), true
	}

	leftNow := factsOf(ctx, l, checksums)
	rightNow := factsOf(ctx, r, checksums)
	rowLeft := plan.Facts{Size: row.LeftSize, Mod: row.LeftMod, Hash: row.LeftHash}
	rowRight := plan.Facts{Size: row.RightSize, Mod: row.RightMod, Hash: row.RightHash}

	// Each side matches its half of the row, so the engine calls both
	// unchanged, yet the sides differ.
	if plan.Same(leftNow, rowLeft, window) && plan.Same(rightNow, rowRight, window) && !plan.Same(leftNow, rightNow, window) {
		return finding("agreedButDiffer", key, "", true, describe(leftNow, rightNow)...), true
	}

	// The row's halves describe different files, which the apply stage would
	// never have written.
	if !plan.Same(rowLeft, rowRight, window) {
		return finding("recordDisagreesWithItself", key, "", false, describe(rowLeft, rowRight)...), true
	}

	return Finding{}, false
}

// factsOf is what one side holds right now. The hash is only read when asked
// for; an empty hash makes the comparison use size and time.
func factsOf(ctx context.Context, e *scan.Entry, checksums bool) plan.Facts {
	f := plan.Facts{Size: e.Size, Mod: e.Mod}
	if checksums {
		f.Hash = e.Hash(ctx)
	}
	return f
}

// describe puts both versions into the finding's values, with hashes only
// when both were read.
func describe(a, b plan.Facts) []string {
	out := []string{
		"leftSize", strconv.FormatInt(a.Size, 10),
		"rightSize", strconv.FormatInt(b.Size, 10),
		"leftMod", a.Mod.UTC().Format(time.RFC3339),
		"rightMod", b.Mod.UTC().Format(time.RFC3339),
	}
	if a.Hash != "" && b.Hash != "" {
		out = append(out, "leftHash", a.Hash, "rightHash", b.Hash)
	}
	return out
}

// recordOf reads the job's record. It refuses a missing one rather than let
// state.Open create it: an empty record would report every file on both sides.
func recordOf(ctx context.Context, path string) (map[string]state.Entry, error) {
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("this job has no record yet at %s, so there is nothing to hold the two sides up against; it has never run", path)
		}
		return nil, fmt.Errorf("the record at %s cannot be read: %w", path, err)
	}
	db, err := state.Open(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("the record at %s cannot be read: %w", path, err)
	}
	defer db.Close()

	prev, err := db.All(ctx)
	if err != nil {
		return nil, fmt.Errorf("the record at %s cannot be read: %w", path, err)
	}
	return prev, nil
}

// foldCase decides whether names are matched case-insensitively, the same way
// the engine's unexported foldCase does.
func foldCase(ends map[plan.Side]rclonefs.Fs, opt engine.Options) bool {
	if opt.ForceFoldCase != nil {
		return *opt.ForceFoldCase
	}
	for _, side := range sides {
		f := ends[side]
		if f == nil {
			continue
		}
		if features := f.Features(); features != nil && features.CaseInsensitive {
			return true
		}
	}
	return false
}

func sideOf(j job.Job, s plan.Side) string {
	if s == plan.Left {
		return j.Left
	}
	return j.Right
}

func finding(code, path, side string, invisible bool, pairs ...string) Finding {
	vars := make(map[string]string, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		vars[pairs[i]] = pairs[i+1]
	}
	if len(vars) == 0 {
		vars = nil
	}
	// An unworded code falls back to the code itself rather than a blank.
	template, worded := findingText[code]
	if !worded || template == "" {
		template = code
	}
	return Finding{
		Code:      code,
		Path:      path,
		Side:      side,
		Vars:      vars,
		Text:      fill(template, vars),
		Invisible: invisible,
	}
}

// fill substitutes {name} for the value of name.
func fill(template string, vars map[string]string) string {
	out := template
	for name, value := range vars {
		out = strings.ReplaceAll(out, "{"+name+"}", value)
	}
	return out
}
