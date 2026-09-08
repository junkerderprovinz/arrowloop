// Command arrowloop synchronises two folders in both directions.
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

	"github.com/junkerderprovinz/arrowloop/internal/boot"

	// The four kinds of target this product promises: a local disk or mounted
	// share, anything speaking the S3 API (MinIO, Garage, Backblaze), SSH, and
	// SMB, which is what an Unraid share is. Importing backend/all would pull
	// in every cloud SDK rclone supports and inflate the binary by an order of
	// magnitude for targets nobody has asked for yet.
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"
)

const usage = `arrowloop synchronises two folders in both directions.

  arrowloop sync     -left <path> -right <path> -state <db>   run one pair once
  arrowloop run      -config <file> <job>                     run one named job now
  arrowloop web      -config <file>                           serve the interface, schedules included
  arrowloop daemon   -config <file>                           run every scheduled job, no interface
  arrowloop jobs     -config <file>                           list the configured jobs
  arrowloop history  -config <file> [-job <name>]             what the runs did
  arrowloop service  [-config <file>] [-os <goos>]            the service file for this system
  arrowloop version                                           which build this is

Every command takes -h for its own flags.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}

	// Before anything can create a file. The mask governs every create this
	// process makes, rclone's included, so it has to be in place before the
	// first one rather than before the first SYNC: the configuration file and
	// the state databases are written too, and they land in the same share.
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
	case "version", "-version", "--version":
		// A Go binary carries no Windows version resource, so its file
		// properties cannot answer "which build is this". The desktop shell has
		// one; this is the same answer for the command line, and it has to be a
		// command of its own because the banner only prints on `web`, which
		// means the one way to read the version was to start a server.
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

// quieten puts rclone's own chatter behind -v.
//
// The interesting output of this program is the plan: the user has to be able
// to read what will happen to their files without a transfer log in between.
func quieten(ctx context.Context, verbose bool) {
	if !verbose {
		fs.GetConfig(ctx).LogLevel = fs.LogLevelError
	}
}
