// Command spike runs one two-way sync job between two rclone remotes.
//
// This is the walking skeleton of the engine, not the product: no scheduler, no
// web interface, no job configuration file. What it does have is the part that
// decides what happens to a file, which is the part that can lose data and
// therefore the part worth proving first.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

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
	"github.com/junkerderprovinz/reeveroll/internal/plan"
	"github.com/junkerderprovinz/reeveroll/internal/state"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		leftPath  = flag.String("left", "", "left side, any rclone remote or a local path")
		rightPath = flag.String("right", "", "right side, any rclone remote or a local path")
		statePath = flag.String("state", "", "path to the job's state database")
		dryRun    = flag.Bool("dry-run", false, "show the plan and change nothing")
		brakePct  = flag.Int("brake-percent", 50, "refuse a run that would delete more than this share of known files, 0 disables")
		brakeMin  = flag.Int("brake-floor", 10, "never trip the brake below this many deletions")
		modWindow = flag.Duration("mod-window", 2*time.Second, "how far modification times may differ and still count as equal")
		verbose   = flag.Bool("v", false, "let rclone report what it is doing underneath")
	)
	flag.Parse()

	if *leftPath == "" || *rightPath == "" || *statePath == "" {
		flag.Usage()
		return errors.New("left, right and state are all required")
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
	opt := plan.Options{ModWindow: *modWindow, BrakePercent: *brakePct, BrakeFloor: *brakeMin}
	p, err := engine.Prepare(ctx, ends, db, opt)
	if err != nil {
		return err
	}

	if len(p.Actions) == 0 && len(p.Agreed) == 0 {
		fmt.Println("nothing to do")
		return nil
	}
	for _, act := range p.Actions {
		switch act.Kind {
		case plan.Move:
			fmt.Printf("  move     %s: %s -> %s (%s)\n", act.Dst, act.OldPath, act.Path, act.Reason)
		case plan.Copy:
			fmt.Printf("  copy     %s -> %s: %s (%s)\n", act.Src, act.Dst, act.Path, act.Reason)
		case plan.Delete:
			fmt.Printf("  trash    %s: %s (%s)\n", act.Dst, act.Path, act.Reason)
		case plan.Conflict:
			fmt.Printf("  conflict %s (%s), keeping both\n", act.Path, act.Reason)
		}
	}
	if *dryRun {
		fmt.Printf("dry run, nothing changed (%d unchanged)\n", p.Unchanged)
		return nil
	}

	res, err := engine.Execute(ctx, ends, db, p, opt)
	if err != nil {
		return err
	}
	fmt.Printf("done: %d copied, %d moved, %d trashed, %d conflicts, %d unchanged\n",
		res.Copied, res.Moved, res.Trashed, res.Conflicts, p.Unchanged)
	return nil
}
