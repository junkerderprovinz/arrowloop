package apply

import (
	"context"
	"errors"
	"fmt"
	"path"
	"regexp"
	"time"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/operations"

	"github.com/junkerderprovinz/arrowloop/internal/pathid"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// runIDLayout is how a run is stamped into the names it leaves behind: the
// trash directory it files into and the copy a conflict sets aside.
const runIDLayout = "20060102-150405"

// copyName matches what conflictName builds: the stem, the side the version
// came from, the run and the extension, which holds no further dot.
var copyName = regexp.MustCompile(`^(.*)\.conflict-(left|right)-(\d{8}-\d{6})(\.[^.]*)?$`)

// SetAside is a version a conflict kept beside the plain file when nobody was
// there to choose, read back from the name conflictName gave it.
type SetAside struct {
	// Copy is where the set-aside version lives, Plain the file it disagreed
	// with, which holds the other side's version.
	Copy  string
	Plain string
	// Side is where this version came from.
	Side plan.Side
	// At is when the run that set it aside began.
	At time.Time
}

// ParseSetAside reads a conflict copy's name back, and reports false for any
// other name.
func ParseSetAside(p string) (SetAside, bool) {
	dir, base := path.Split(p)
	m := copyName.FindStringSubmatch(base)
	if m == nil {
		return SetAside{}, false
	}
	at, err := time.Parse(runIDLayout, m[3])
	if err != nil {
		return SetAside{}, false
	}
	side := plan.Left
	if m[2] == plan.Right.String() {
		side = plan.Right
	}
	return SetAside{Copy: p, Plain: dir + m[1] + m[4], Side: side, At: at}, true
}

// Version is one file as a side holds it right now.
type Version struct {
	Path string
	Size int64
	Mod  time.Time
}

// Open is a conflict still waiting for somebody: both sides hold the plain
// file and the set-aside copy, and nobody has said which version to keep.
type Open struct {
	SetAside
	// Left and Right are the two versions, each read from its own side under
	// whichever name it sits.
	Left, Right Version
}

// OpenConflicts lists one job's open conflicts, found in the record, which
// holds a row for every copy the engine sets aside. One whose copy or plain
// file has gone from either side was dealt with by hand and is left out.
func OpenConflicts(ctx context.Context, ends Ends, db *state.DB, foldCase bool) ([]Open, error) {
	rows, err := db.Containing(ctx, ".conflict-")
	if err != nil {
		return nil, err
	}
	kept, err := db.Kept(ctx)
	if err != nil {
		return nil, err
	}

	var out []Open
	for _, row := range rows {
		if kept[row.Path] {
			continue
		}
		pair, err := findPair(ctx, ends, db, row, foldCase)
		if errors.Is(err, errGone) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, pair.open(ctx))
	}
	return out, nil
}

// errGone says one of a conflict's four files is not there any more.
var errGone = errors.New("one of the two versions is gone")

// pair is an open conflict with every object it touches opened.
type pair struct {
	SetAside
	copyKey, plainKey string
	// Indexed by plan.Side.
	copies, plains [2]fs.Object
	plainNames     [2]string
}

func (p pair) open(ctx context.Context) Open {
	version := func(o fs.Object) Version {
		return Version{Path: o.Remote(), Size: o.Size(), Mod: o.ModTime(ctx)}
	}
	out := Open{SetAside: p.SetAside}
	out.Left, out.Right = version(p.plains[plan.Left]), version(p.plains[plan.Right])
	if p.Side == plan.Left {
		out.Left = version(p.copies[plan.Left])
	} else {
		out.Right = version(p.copies[plan.Right])
	}
	return out
}

// findPair opens a set-aside copy and its plain file on both sides. The plain
// name is taken from its own record where there is one, because the two sides
// can spell a name differently and the copy was named after the losing side's
// spelling.
func findPair(ctx context.Context, ends Ends, db *state.DB, row state.Entry, foldCase bool) (pair, error) {
	aside, ok := ParseSetAside(row.LeftPath)
	if !ok {
		return pair{}, errGone
	}
	p := pair{SetAside: aside, copyKey: row.Path, plainKey: pathid.Key(aside.Plain, foldCase)}
	p.plainNames = [2]string{aside.Plain, aside.Plain}
	if plain, found, err := db.Get(ctx, p.plainKey); err != nil {
		return pair{}, err
	} else if found {
		p.plainNames = [2]string{plain.LeftPath, plain.RightPath}
	}

	copyNames := [2]string{row.LeftPath, row.RightPath}
	for _, side := range []plan.Side{plan.Left, plan.Right} {
		f := ends.side(side)
		var err error
		if p.copies[side], err = f.NewObject(ctx, copyNames[side]); err != nil {
			return pair{}, missing(err, side, copyNames[side])
		}
		if p.plains[side], err = f.NewObject(ctx, p.plainNames[side]); err != nil {
			return pair{}, missing(err, side, p.plainNames[side])
		}
	}
	return p, nil
}

// missing tells a file that is not there from one that could not be looked at.
func missing(err error, side plan.Side, name string) error {
	if errors.Is(err, fs.ErrorObjectNotFound) || errors.Is(err, fs.ErrorIsDir) {
		return errGone
	}
	return fmt.Errorf("look up %q on the %s side: %w", name, side, err)
}

// Decision answers one open conflict, named by its set-aside copy.
type Decision struct {
	Copy string
	Keep plan.Resolution
}

// Decide carries out what somebody chose for conflicts a run kept both
// versions of, with the outcome a choice before the run gives: the chosen
// version under the plain name on both sides and the other in the trash.
// Keeping both only records the decision, and one that fails becomes a skip.
func Decide(ctx context.Context, ends Ends, db *state.DB, decisions []Decision, opt plan.Options, watcher Progress) (Result, error) {
	t := &tally{progress: watcher}
	t.logger, _ = watcher.(Logger)
	t.total = len(decisions)
	if watcher != nil {
		watcher.Starting(t.total)
	}
	runID := time.Now().UTC().Format(runIDLayout)
	rec := recorder{ends: ends, db: db, window: opt.ModWindow, observe: t.observe}

	for _, d := range decisions {
		err := decide(ctx, ends, rec, d, opt.FoldCase, runID, t)
		var dis *DisagreementError
		switch {
		case err == nil:
		case errors.As(err, &dis):
			return t.res, err
		case errors.Is(err, errGone):
			t.skip(d.Copy, "", plan.Because("conflictGone"))
		default:
			t.skip(d.Copy, "", whyFailed(ends, nil, "conflict", "stepFailed", err))
		}
	}
	return t.res, nil
}

func decide(ctx context.Context, ends Ends, rec recorder, d Decision, foldCase bool, runID string, t *tally) error {
	row, found, err := rec.db.Get(ctx, pathid.Key(d.Copy, foldCase))
	if err != nil {
		return err
	}
	if !found {
		return errGone
	}
	p, err := findPair(ctx, ends, rec.db, row, foldCase)
	if err != nil {
		return err
	}
	binned := ""
	if trashKept(ctx) {
		binned = NoteBin
	}

	switch {
	case d.Keep == plan.KeepBoth:
		if err := rec.db.Keep(ctx, p.copyKey, time.Now()); err != nil {
			return err
		}

	case chosenSide(d.Keep) == p.Side:
		// The set-aside version wins, so on each side the plain file goes and
		// the copy takes its name, the same two steps chosenSteps takes.
		for _, side := range []plan.Side{plan.Left, plan.Right} {
			f, plain, aside := ends.side(side), p.plains[side], p.copies[side]
			if err := discard(ctx, f, plain, runID); err != nil {
				return fmt.Errorf("get rid of the %s version: %w", side.Other(), err)
			}
			t.count(func(r *Result) { r.Trashed++ })
			t.logged(Entry{Kind: "trash", Side: side.String(), Path: plain.Remote(), Note: binned, Size: plain.Size()})
			if err := operations.MoveFile(ctx, f, f, p.plainNames[side], aside.Remote()); err != nil {
				return fmt.Errorf("put the %s version under the plain name: %w", p.Side, err)
			}
			t.count(func(r *Result) { r.Moved++ })
			t.logged(Entry{Kind: "move", Side: side.String(), Path: p.plainNames[side], Note: aside.Remote(), Size: aside.Size()})
		}
		if err := rec.db.Forget(ctx, p.copyKey); err != nil {
			return err
		}
		if err := rec.settle(ctx, p.plainKey, p.plainNames[plan.Left], p.plainNames[plan.Right], true); err != nil {
			return err
		}

	default:
		for _, side := range []plan.Side{plan.Left, plan.Right} {
			aside := p.copies[side]
			if err := discard(ctx, ends.side(side), aside, runID); err != nil {
				return fmt.Errorf("get rid of the %s version: %w", p.Side, err)
			}
			t.count(func(r *Result) { r.Trashed++ })
			t.logged(Entry{Kind: "trash", Side: side.String(), Path: aside.Remote(), Note: binned, Size: aside.Size()})
		}
		if err := rec.db.Forget(ctx, p.copyKey); err != nil {
			return err
		}
	}

	t.note("conflict", p.Plain, "", d.Keep.String())
	return nil
}

// chosenSide is the side a resolution that picks one keeps.
func chosenSide(r plan.Resolution) plan.Side {
	if r == plan.KeepRight {
		return plan.Right
	}
	return plan.Left
}
