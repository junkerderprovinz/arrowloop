// Command reeveroll synchronises two folders in both directions.
//
// It has two ways in. `sync` takes a pair of paths on the command line and runs
// once, which is what a person wants while setting a job up or checking a
// suspicion. Everything else works from a configuration file holding named
// jobs, which is what a machine wants: `daemon` runs them on their schedules,
// `run` runs one by name, `history` says what happened, and `service` produces
// the file this operating system needs to keep the daemon alive.
package main

import (
	"context"
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
)

const usage = `reeveroll synchronises two folders in both directions.

  reeveroll sync     -left <path> -right <path> -state <db>   run one pair once
  reeveroll run      -config <file> <job>                     run one named job now
  reeveroll web      -config <file>                           serve the interface, schedules included
  reeveroll daemon   -config <file>                           run every scheduled job, no interface
  reeveroll jobs     -config <file>                           list the configured jobs
  reeveroll history  -config <file> [-job <name>]             what the runs did
  reeveroll service  [-config <file>] [-os <goos>]            the service file for this system

Every command takes -h for its own flags.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	// rclone reads its own config for named remotes such as "sftp:backup". A
	// job using plain paths never needs it.
	configfile.Install()

	ctx := context.Background()
	args := os.Args[2:]

	var err error
	switch os.Args[1] {
	case "sync":
		err = cmdSync(ctx, args)
	case "run":
		err = cmdRun(ctx, args)
	case "web":
		err = cmdWeb(ctx, args)
	case "daemon":
		err = cmdDaemon(ctx, args)
	case "jobs":
		err = cmdJobs(ctx, args)
	case "history":
		err = cmdHistory(ctx, args)
	case "service":
		err = cmdService(args)
	case "healthcheck":
		err = cmdHealth(ctx, args)
	case "-h", "--help", "help":
		fmt.Print(usage)
		return
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// repeatable collects a flag that may be given more than once.
type repeatable []string

func (r *repeatable) String() string     { return strings.Join(*r, ",") }
func (r *repeatable) Set(v string) error { *r = append(*r, v); return nil }

// quieten puts rclone's own chatter behind -v.
//
// The interesting output of this program is the plan: the user has to be able
// to read what will happen to their files without a transfer log in between.
func quieten(ctx context.Context, verbose bool) {
	if !verbose {
		fs.GetConfig(ctx).LogLevel = fs.LogLevelError
	}
}
