package main

import (
	"context"
	"errors"
	"flag"
	"fmt"

	"github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/state"
)

// cmdSync runs one pair of paths once, entirely from flags.
//
// This is the shape a person wants while setting a job up: nothing to write to
// disk first, and -dry-run to see what would happen before anything does. A
// machine wants the configuration file instead, which is what every other
// command works from.
func cmdSync(ctx context.Context, args []string) error {
	defaults := plan.DefaultOptions()
	fset := flag.NewFlagSet("sync", flag.ExitOnError)
	var excludes repeatable
	var (
		leftPath   = fset.String("left", "", "left side, any rclone remote or a local path")
		rightPath  = fset.String("right", "", "right side, any rclone remote or a local path")
		statePath  = fset.String("state", "", "path to the job's state database")
		dryRun     = fset.Bool("dry-run", false, "show the plan and change nothing")
		brakePct   = fset.Int("brake-percent", defaults.BrakePercent, "refuse a run that would delete more than this share of known files, 0 disables")
		brakeMin   = fset.Int("brake-floor", defaults.BrakeFloor, "never trip the brake below this many deletions")
		modWindow  = fset.Duration("mod-window", defaults.ModWindow, "how far modification times may differ and still count as equal")
		quiet      = fset.Duration("quiet-period", defaults.QuietPeriod, "how long a file must sit unchanged before it is touched, 0 disables")
		noDefaults = fset.Bool("no-default-excludes", false, "also sync half-written files such as *.part and Office owner files")
		transfers  = fset.Int("transfers", defaults.Transfers, "how many files may be copied at the same time")
		bwLimit    = fset.String("bwlimit", "", "bandwidth limit in rclone syntax, for example 1M or a timetable")
		emptyDirs  = fset.Bool("empty-dirs", false, "also carry folders that hold no files")
		metadata   = fset.Bool("metadata", false, "carry permissions, ownership and extended attributes where both sides can")
		verbose    = fset.Bool("v", false, "let rclone report what it is doing underneath")
	)
	fset.Var(&excludes, "exclude", "glob of paths to leave alone entirely, repeatable")
	if err := fset.Parse(args); err != nil {
		return err
	}

	if *leftPath == "" || *rightPath == "" || *statePath == "" {
		fset.Usage()
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

	quieten(ctx, *verbose)

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
	if err := engine.StartAccounting(ctx, *bwLimit); err != nil {
		return err
	}
	ctx = engine.Configure(ctx, opt)

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
