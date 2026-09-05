// Command reeveroll runs one two-way sync job between two rclone remotes.
//
// This is the engine with a command line bolted on, not the product: no
// scheduler, no web interface, no job configuration. What it does have is the
// part that decides what happens to a file, which is the part that can lose
// data and therefore the part worth proving first.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configfile"

	// Only the backends this stage needs. Importing backend/all would pull in
	// every cloud SDK rclone supports and inflate the binary by an order of
	// magnitude for targets nobody has asked for yet.
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"

	"github.com/junkerderprovinz/reeveroll/internal/apply"
	"github.com/junkerderprovinz/reeveroll/internal/engine"
	"github.com/junkerderprovinz/reeveroll/internal/filter"
	"github.com/junkerderprovinz/reeveroll/internal/plan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

// repeatable collects a flag that may be given more than once.
type repeatable []string

func (r *repeatable) String() string     { return strings.Join(*r, ",") }
func (r *repeatable) Set(v string) error { *r = append(*r, v); return nil }

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	defaults := plan.DefaultOptions()
	var excludes repeatable
	var (
		leftPath   = flag.String("left", "", "left side, any rclone remote or a local path")
		rightPath  = flag.String("right", "", "right side, any rclone remote or a local path")
		statePath  = flag.String("state", "", "path to the job's state database")
		dryRun     = flag.Bool("dry-run", false, "show the plan and change nothing")
		brakePct   = flag.Int("brake-percent", defaults.BrakePercent, "refuse a run that would delete more than this share of known files, 0 disables")
		brakeMin   = flag.Int("brake-floor", defaults.BrakeFloor, "never trip the brake below this many deletions")
		modWindow  = flag.Duration("mod-window", defaults.ModWindow, "how far modification times may differ and still count as equal")
		quiet      = flag.Duration("quiet-period", defaults.QuietPeriod, "how long a file must sit unchanged before it is touched, 0 disables")
		noDefaults = flag.Bool("no-default-excludes", false, "also sync half-written files such as *.part and Office owner files")
		transfers  = flag.Int("transfers", defaults.Transfers, "how many files may be copied at the same time")
		bwLimit    = flag.String("bwlimit", "", "bandwidth limit in rclone syntax, for example 1M or a timetable")
		emptyDirs  = flag.Bool("empty-dirs", false, "also carry folders that hold no files")
		metadata   = flag.Bool("metadata", false, "carry permissions, ownership and extended attributes where both sides can")
		verbose    = flag.Bool("v", false, "let rclone report what it is doing underneath")
	)
	flag.Var(&excludes, "exclude", "glob of paths to leave alone entirely, repeatable")
	flag.Parse()

	if *leftPath == "" || *rightPath == "" || *statePath == "" {
		flag.Usage()
		return errors.New("left, right and state are all required")
	}

	patterns := append([]string(nil), excludes...)
	if !*noDefaults {
		patterns = append(patterns, filter.InProgress...)
	}
	exclude, err := filter.New(patterns)
	if err != nil {
		return err
	}

	ctx := context.Background()

	// rclone talks to whoever will listen. Its own progress and config notes
	// belong behind -v, because the interesting output here is the plan: the
	// user has to be able to read what will happen to their files without a
	// transfer log in between.
	if !*verbose {
		fs.GetConfig(ctx).LogLevel = fs.LogLevelError
	}

	// Loads rclone.conf if it exists, so named remotes work. Plain paths do
	// not need it.
	configfile.Install()

	left, err := fs.NewFs(ctx, *leftPath)
	if err != nil {
		return fmt.Errorf("left side: %w", err)
	}
	right, err := fs.NewFs(ctx, *rightPath)
	if err != nil {
		return fmt.Errorf("right side: %w", err)
	}

	db, err := state.Open(ctx, *statePath)
	if err != nil {
		return err
	}
	defer db.Close()

	ends := apply.Ends{Left: left, Right: right}
	opt := engine.Options{
		Compare: plan.Options{
			ModWindow:    *modWindow,
			QuietPeriod:  *quiet,
			BrakePercent: *brakePct,
			BrakeFloor:   *brakeMin,
			Transfers:    *transfers,
		},
		Exclude:   exclude,
		EmptyDirs: *emptyDirs,
		Metadata:  *metadata,
	}
	if err := engine.Configure(ctx, opt, *bwLimit); err != nil {
		return err
	}

	p, compare, err := engine.Prepare(ctx, ends, db, opt)
	if err != nil {
		return err
	}

	report(p)
	if len(p.Actions) == 0 && len(p.Agreed) == 0 && !hasDirWork(p) {
		return nil
	}
	if *dryRun {
		fmt.Printf("dry run, nothing changed (%d unchanged)\n", p.Unchanged)
		return nil
	}

	res, err := engine.Execute(ctx, ends, db, p, compare)
	if err != nil {
		return err
	}
	fmt.Printf("done: %d copied, %d moved, %d trashed, %d conflicts, %d folders made, %d folders removed, %d unchanged, %d left for later\n",
		res.Copied, res.Moved, res.Trashed, res.Conflicts, res.DirsMade, res.DirsRemoved, p.Unchanged, len(res.Skipped))
	for _, s := range res.Skipped {
		fmt.Printf("  later    %s (%s)\n", s.Path, s.Reason)
	}
	return nil
}

func report(p *plan.Plan) {
	for _, act := range p.Actions {
		switch act.Kind {
		case plan.Move:
			fmt.Printf("  move     %s: %s -> %s (%s)\n", act.Dst, act.OldDstPath, act.DstPath, act.Reason)
		case plan.Copy:
			fmt.Printf("  copy     %s -> %s: %s (%s)\n", act.Src, act.Dst, act.DstPath, act.Reason)
		case plan.Delete:
			fmt.Printf("  trash    %s: %s (%s)\n", act.Dst, act.Path, act.Reason)
		case plan.Conflict:
			fmt.Printf("  conflict %s (%s), keeping both\n", act.Path, act.Reason)
		}
	}
	for _, d := range p.Dirs {
		switch d.Kind {
		case plan.MakeDir:
			fmt.Printf("  mkdir    %s: %s (%s)\n", d.Dst, d.DstPath, d.Reason)
		case plan.RemoveDir:
			if d.DstPath != "" {
				fmt.Printf("  rmdir    %s: %s (%s)\n", d.Dst, d.DstPath, d.Reason)
			}
		}
	}
	for _, s := range p.Skipped {
		fmt.Printf("  later    %s (%s)\n", s.Path, s.Reason)
	}
	if len(p.Actions) == 0 && len(p.Agreed) == 0 && len(p.Skipped) == 0 && !hasDirWork(p) {
		fmt.Println("nothing to do")
	}
}

// hasDirWork reports whether any directory action would actually touch a side.
// A plan full of record refreshes is not work the user needs to be told about.
func hasDirWork(p *plan.Plan) bool {
	for _, d := range p.Dirs {
		if d.Kind != plan.RecordDir && d.DstPath != "" {
			return true
		}
	}
	return false
}
