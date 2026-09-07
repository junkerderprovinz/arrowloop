// Package verify holds the record up against both sides and reports where the
// two accounts disagree.
//
// The failure it exists for is the one the engine cannot see from the inside. A
// state row means "the two sides agreed on this file, and here is what each of
// them held". Every later run is decided against that row: a side that still
// matches its half counts as unchanged, and when both sides count as unchanged
// the run does nothing at all and reports a success. That is the correct
// behaviour, and it is exactly why a row that is WRONG is so much worse than a
// row that is missing. A row claiming an agreement that never happened goes on
// matching both sides for ever, so every run afterwards reads a pair of folders
// that have actually drifted apart as a pair with nothing to do. Nothing fails,
// nothing appears in the log, and the two sides stay different until somebody
// opens the file on the wrong machine and finds last month's version.
//
// The run that writes the record already refuses to write such a row: the apply
// stage re-reads both sides after every transfer and fails the run loudly
// rather than record an agreement it cannot prove. That guard covers the rows
// this program writes and nothing else. A record restored from a backup taken
// between two runs, a record copied to a second machine whose folders have
// since moved on, a row edited by hand to unstick a job, a crash between the
// bytes landing and the row being written: none of those pass through the
// guard, and every one of them is an ordinary thing that happens to a file on a
// disk.
//
// So this is the check somebody presses. It reads both sides fresh, reads the
// record, and reports every path where the two do not line up. It repairs
// nothing, on purpose. What a repair should DO with a row claiming a false
// agreement has more than one defensible answer, and a button that diagnoses
// and repairs in the same press never lets anybody read the diagnosis first.
//
// Directories are deliberately left out. The record keeps them in a table of
// their own, only for the jobs that carry empty directories at all, and a
// directory has no content to disagree about, so the whole class of failure
// above cannot happen to one.
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

// Finding is one path where the record and the two sides do not agree.
//
// This follows precheck.Finding rather than plan.Reason, and the deciding
// difference is the severity field. A reason explains one action inside a plan
// that a person is already reading as a whole; a finding is a row in a list
// that has no surrounding context, so it has to carry its own judgement of how
// bad it is. What it drops from precheck.Finding is Fatal, which means "this
// would stop the job running" and is a question nothing here asks: none of
// these findings stops a run, and several of them describe work the next run
// will do quite happily.
//
// Code and Vars rather than a sentence, for the reason the whole engine words
// things this way: the interface translates, and no part of the engine has any
// business knowing which language somebody reads. The English wording travels
// alongside for a reader that has never heard of the code, because an
// untranslated explanation is worth more than a blank.
type Finding struct {
	Code string `json:"code"`

	// Path is the matching key, which is what the record is keyed by. It is not
	// necessarily the name either side spells the file with: a name stored
	// decomposed on one side and composed on the other is one key and two
	// spellings, and the vars carry the real names where they differ.
	Path string `json:"path"`

	// Side names the one end a finding is about, and is empty for a finding
	// about a path as a whole.
	Side string `json:"side,omitempty"`

	Vars map[string]string `json:"vars,omitempty"`
	Text string            `json:"text"`

	// Invisible says that no future run will notice this on its own.
	//
	// It is the single most important thing a screen can sort on, and it is a
	// judgement the engine must make rather than the interface: a list of codes
	// with no severity forces every screen to keep its own copy of which ones
	// matter, and those copies drift. A row claiming an agreement that does not
	// hold is invisible, because both sides match it and every run therefore
	// concludes there is nothing to do, for ever. A record that has never heard
	// of a file is not, because the next run will see it, compare it and write
	// the row. The second kind is worth reporting and does not need anybody to
	// act; the first kind stays exactly as it is until somebody does.
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

// Report is everything one check learned about one job.
//
// The counts are not decoration. A report with no findings means one of two
// completely different things, "the sides and the record agree" or "nothing was
// actually compared", and the difference is invisible unless the report says
// how much it looked at. A check whose empty answer can be mistaken for a
// healthy one is worse than no check.
type Report struct {
	Job string `json:"job"`

	// Checksums says whether the content of the files was read, and it decides
	// what this whole report is worth. See Opts.Checksums.
	Checksums bool `json:"checksums"`

	// Known is how many rows the record holds for paths this job can see,
	// LeftFiles and RightFiles what each side listed, and Checked how many
	// distinct paths were compared. Checked is the union of the three and is
	// therefore the number that says whether the check had anything to work on.
	Known      int `json:"known"`
	LeftFiles  int `json:"leftFiles"`
	RightFiles int `json:"rightFiles"`
	Checked    int `json:"checked"`

	// Collisions is how many keys were left out because one side holds two
	// files whose names the other side could not tell apart. See the comment at
	// the loop that skips them.
	Collisions int `json:"collisions"`

	// Found is how many findings the check produced and Returned is how many of
	// them are in the list below.
	//
	// Both numbers, always, and never just the length of the list. A tree with
	// forty thousand files whose record was wiped produces forty thousand
	// findings, and a browser handed all of them is a browser that stops
	// responding. The moment the list is bounded, a list of five hundred that
	// says nothing about the bound reads exactly like a complete list of five
	// hundred, which would turn a catastrophe into a manageable looking
	// afternoon. Truncated is derived from the two, and is carried anyway so
	// that a screen cannot forget to make the comparison itself.
	Found     int  `json:"found"`
	Returned  int  `json:"returned"`
	Truncated bool `json:"truncated"`

	Findings []Finding `json:"findings"`
}

// Opts is what a caller can vary about the check.
type Opts struct {
	// Checksums makes the comparison read the content of every file on both
	// sides instead of judging by size and modification time.
	//
	// It is off by default because it is not a small cost: it reads every byte
	// of both trees, which on a large job over a network is longer than the
	// sync itself. What that buys, and what its absence costs, is worth being
	// exact about, because a check that overstates what it proved is the same
	// class of problem as the record it is checking.
	//
	// WITHOUT checksums the comparison is a size and a modification time inside
	// the job's own window, which is the same rule the engine uses to decide
	// what to copy. It can therefore prove that the engine will never notice a
	// difference, and that is the real question here. What it cannot do is
	// prove the two sides hold the same bytes: two different files of the same
	// length written in the same second are indistinguishable to it, and that
	// is precisely the shape of a divergence that got frozen into the record.
	// So an empty report from a run without checksums means "nothing that size
	// and time can see", never "the two sides are identical".
	//
	// WITH checksums the comparison is of the content, and both halves get
	// stronger: a difference it reports is a real difference in the bytes, and
	// a path it stays quiet about really does hold the same file on both sides.
	// It is still only as good as the backends: a side that cannot produce a
	// hash at all, such as plain SFTP without a remote shell, falls back to
	// size and time for that file on its own, and the report says nothing
	// special about it because the fallback is the ordinary rule rather than a
	// fault.
	Checksums bool

	// Limit bounds the list of findings. Zero means DefaultLimit and anything
	// above MaxLimit is cut to it, so no caller can ask for a document that
	// takes a browser down. The report always counts every finding, whether it
	// carries it or not.
	Limit int
}

// DefaultLimit and MaxLimit bound the answer. Five hundred rows is already more
// than anybody reads: past that the useful information is the total, which the
// report carries regardless.
const (
	DefaultLimit = 500
	MaxLimit     = 5000
)

// sides is the order every loop here goes in, so that a report reads the same
// way twice.
var sides = [...]plan.Side{plan.Left, plan.Right}

// Check compares both sides of one job against its record.
//
// It returns an error where precheck deliberately does not, and the difference
// is the job each of them has. precheck exists to DESCRIBE a broken job, so an
// unplugged drive is its answer rather than its failure. This one exists to
// compare two things, and a comparison that could not read one of them has no
// answer at all: handing back an empty list of findings because a side would
// not open would be a clean bill of health issued by a check that never
// happened, which is the exact failure this package was written to catch.
func Check(ctx context.Context, j job.Job, opt Opts) (Report, error) {
	// The empty list is set up front rather than at the end. Every early return
	// below carries this report back beside its error, and a nil slice encodes
	// as null: a screen promised a list would have to guard every use of it,
	// including on the paths where something went wrong and it is least likely
	// to be tested.
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

	// Both sides are resolved before either is opened, for the reason the runner
	// resolves them first: a drive letter that has since been handed to a
	// different disk is not empty, and a check that opened it would compare the
	// record against a stranger's files and report every path in the job.
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

	// The same folding decision the run makes, taken the same way. If this check
	// matched names by a different key than the engine does, it would line up
	// the record against the sides differently, and every file whose name the
	// two rules disagree about would be reported as missing on both sides at
	// once: a whole tree of findings that exist only inside this function.
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

	// The record is filtered exactly as the two sides are, and this is not a
	// nicety. A pattern somebody added last week hides its paths from both
	// listings while their rows stay in the record, so without this every
	// newly excluded file would be reported as a row for a file on neither
	// side. The engine filters the record in the same place and for a harder
	// reason: reading those rows as deletions is how one exclude pattern
	// destroys the files it was meant to leave alone.
	visible := make(map[string]state.Entry, len(prev))
	for key, entry := range prev {
		if settings.Exclude.Excluded(entry.LeftPath) || settings.Exclude.Excluded(entry.RightPath) || settings.Exclude.Excluded(key) {
			continue
		}
		visible[key] = entry
	}

	// A side that lists nothing while the record knows files is refused here in
	// the engine's own words, rather than compared.
	//
	// Comparing it would technically work and would be useless: every recorded
	// path would come back as gone from one side, thousands of findings for one
	// fact, and the one fact, that the share is not mounted, would be the only
	// thing not said. It is also the exact condition the engine refuses a run
	// for, so a person who presses this after a failed run should read the same
	// sentence rather than a second wording of it.
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

	// A key that collides on either side is left out of the comparison entirely.
	//
	// The scanner drops such a key from that side's listing, because copying two
	// files whose names the other side cannot tell apart would silently
	// overwrite one with the other. That leaves the record holding a row for a
	// path this check can no longer see on that side, and reporting it as gone
	// would be a false alarm about a file that is sitting right there. The
	// preview reports collisions properly, with both real names, which is where
	// somebody can actually act on one, so the count is enough here.
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

	// Sorted, and that matters more here than it looks. The list is bounded, so
	// an unsorted walk over a map would return a different arbitrary five
	// hundred of the same forty thousand findings on every press: two checks of
	// an unchanged tree would disagree, and nobody could work through the list
	// because it would reshuffle underneath them.
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
		// Counted before it is carried, so that the total is the truth even
		// when the list stops.
		rep.Found++
		if len(rep.Findings) < limit {
			rep.Findings = append(rep.Findings, found)
		}
	}

	rep.Returned = len(rep.Findings)
	rep.Truncated = rep.Found > rep.Returned
	return rep, nil
}

// judge decides what one path has to say, and says at most one thing about it.
//
// One finding per path is a deliberate contract rather than an implementation
// detail. These conditions overlap: a row that contradicts itself is also, when
// both sides still match their halves of it, a frozen disagreement. Emitting
// both would make the totals uninterpretable, because "eight hundred findings"
// would no longer be a number of paths, and would leave a screen deciding for
// itself which of two rows about one file is the one to show.
func judge(ctx context.Context, key string, l, r *scan.Entry, row state.Entry, hasRow, checksums bool, window time.Duration) (Finding, bool) {
	onLeft, onRight := l != nil, r != nil

	switch {
	case !hasRow && onLeft && onRight:
		// Not necessarily a fault, and reported all the same. Two people saving
		// the same attachment in the same folder produce this honestly, and so
		// does a record that was wiped or replaced with an older copy. The next
		// run will compare the two and write the row either way, so it is not
		// invisible; what makes it worth a line is that a hundred thousand of
		// them at once is a record that is not the record for these folders.
		return finding("onBothSidesUnrecorded", key, "", false), true

	case !hasRow:
		// On one side only and never recorded: an ordinary new file, which is
		// the most common thing in any sync job. Reporting it would bury every
		// real finding under the normal traffic of a working job, and the
		// preview already lists exactly these as the copies it would make.
		return Finding{}, false

	case !onLeft && !onRight:
		return finding("recordedButOnNeitherSide", key, "", false,
			"leftPath", row.LeftPath, "rightPath", row.RightPath), true

	case !onLeft || !onRight:
		// The record only ever holds a path once both sides held it, so a row
		// plus one side is always "it went away over there". That is also what
		// an ordinary deletion looks like on the way to being propagated, and
		// the check cannot tell the two apart: it sees one moment, and a
		// deletion somebody made a second ago and a folder that half mounted
		// look identical in it. Saying so plainly and marking it as something
		// the next run will act on is more honest than guessing.
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

	// The frozen disagreement, and the reason this package exists. Each side
	// still matches its own half of the row, so the engine will call both of
	// them unchanged and do nothing; and the two sides do not match each other,
	// so there is something it should have done. Every run from here to the end
	// of time reports success and changes nothing.
	if plan.Same(leftNow, rowLeft, window) && plan.Same(rightNow, rowRight, window) && !plan.Same(leftNow, rightNow, window) {
		return finding("agreedButDiffer", key, "", true, describe(leftNow, rightNow)...), true
	}

	// The row's two halves describe different files. It cannot have been a real
	// agreement, whatever either side holds now: the run that wrote it compares
	// the two sides by exactly this rule and refuses to write a row that fails
	// it. Reached only when at least one side has since moved on, because the
	// case where neither has is the one above.
	if !plan.Same(rowLeft, rowRight, window) {
		return finding("recordDisagreesWithItself", key, "", false, describe(rowLeft, rowRight)...), true
	}

	return Finding{}, false
}

// factsOf is what one side holds right now, in the shape the comparison takes.
//
// The hash is read only when it was asked for. Leaving it empty is not a
// shortcut and not a lie: an empty hash means "unknown" everywhere in this
// engine, and the comparison falls back to size and modification time, which is
// the same judgement the engine itself makes on a backend that cannot hash.
func factsOf(ctx context.Context, e *scan.Entry, checksums bool) plan.Facts {
	f := plan.Facts{Size: e.Size, Mod: e.Mod}
	if checksums {
		f.Hash = e.Hash(ctx)
	}
	return f
}

// describe puts both versions into the finding's values.
//
// The numbers are what makes a finding actionable: "these two disagree" sends
// somebody to look at a file, "5 bytes here and 8 bytes there" tells them which
// one is the truncated one before they open either. Hashes only when they were
// actually read, so that an empty one can never be mistaken for a hash of
// nothing.
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

// recordOf reads the job's record, and refuses to make one.
//
// state.Open creates a database that is not there, and this must never be the
// call that does it. Two reasons, and the second is the one that matters: a
// question about a job should not leave a new file on somebody's disk, and a
// job that has never run has an empty record, against which every single file
// on both sides is a file the record has never heard of. That report would be
// thousands of findings long, every one of them wrong, for a job with nothing
// whatsoever the matter with it.
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

	// Read rather than merely opened. Opening proves the file is a database;
	// only reading proves it is one this build understands, and a check that
	// reported an empty record for a schema it could not read would report
	// every file on both sides as unknown to it.
	prev, err := db.All(ctx)
	if err != nil {
		return nil, fmt.Errorf("the record at %s cannot be read: %w", path, err)
	}
	return prev, nil
}

// foldCase decides whether names are matched case-insensitively, the same way
// the engine decides it.
//
// The engine's own copy of this is not exported and this package may not reach
// into it. Both answers have to stay the same one: a check that folded where a
// run does not would match the record against the sides by a key the run never
// uses, and would then report differences that only exist in its own reading.
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
	// A code nobody has worded yet answers with the code itself rather than
	// with an empty string. An interface that does not recognise the code falls
	// back to this sentence, so a blank one leaves a row on the screen with
	// nothing in it at all, and a dotted identifier is worth more than nothing.
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
