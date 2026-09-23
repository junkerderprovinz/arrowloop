// Command arrowloop synchronises two folders in both directions.
//
// `sync` runs one pair of paths given on the command line once. The other
// commands work from a configuration file of named jobs: `daemon` runs them on
// their schedules, `run` runs one by name, `history` says what happened, and
// `service` prints the file this operating system needs to keep the daemon
// running.
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configfile"

	"github.com/junkerderprovinz/arrowloop/internal/boot"

	// Every backend rclone carries, so the interface can offer whatever is
	// compiled in. It roughly doubles the size of the binary.
	_ "github.com/rclone/rclone/backend/all"
)

const usage = `arrowloop synchronises two folders in both directions.

  arrowloop sync     -left <path> -right <path> -state <db>   run one pair once
  arrowloop run      -config <file> <job>                     run one named job now
  arrowloop web      -config <file>                           serve the interface, schedules included
  arrowloop daemon   -config <file>                           run every scheduled job, no interface
  arrowloop jobs     -config <file>                           list the configured jobs
  arrowloop history  -config <file> [-job <name>]             what the runs did
  arrowloop service  [-config <file>] [-os <goos>]            the service file for this system
  arrowloop hash-password                                     the value for ARROWLOOP_PASSWORD_HASH
  arrowloop version                                           which build this is

Every command takes -h for its own flags.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	// Before anything opens a connection or reads a clock (see android.go).
	applyAndroidEnvironment()

	// Before anything creates a file, the configuration and state databases
	// included.
	if err := applyUmask(umaskSetting()); err != nil {
		fmt.Fprintln(os.Stderr, err)
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
	case "hash-password":
		err = cmdHashPassword(args)
	case "version", "-version", "--version":
		// The binary has no Windows version resource, and the banner only
		// prints on `web`.
		fmt.Println(boot.Version)
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

// quieten puts rclone's own log output behind -v, so the plan stays readable.
func quieten(ctx context.Context, verbose bool) {
	if !verbose {
		fs.GetConfig(ctx).LogLevel = fs.LogLevelError
	}
}
