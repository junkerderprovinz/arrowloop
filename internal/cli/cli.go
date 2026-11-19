// Package cli is the arrowloop command line. The engine binary is nothing
// else, and the desktop app runs it when it is started with a command.
//
// `sync` runs one pair of paths given on the command line once. The other
// commands work from a configuration file of named jobs: `daemon` runs them on
// their schedules, `run` runs one by name, `run-due` runs whatever is due and
// exits, `history` says what happened, and `service` prints the file this
// operating system needs to keep the daemon running.
package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configfile"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

const usage = `arrowloop synchronises two folders in both directions.

  arrowloop sync     -left <path> -right <path> -state <db>   run one pair once
  arrowloop run      -config <file> <job>                     run one named job now
  arrowloop run-due  -config <file>                           run every job that is due, then exit
  arrowloop web      -config <file>                           serve the interface, schedules included
  arrowloop daemon   -config <file>                           run every scheduled job, no interface
  arrowloop jobs     -config <file>                           list the configured jobs
  arrowloop history  -config <file> [-job <name>]             what the runs did
  arrowloop service  [-config <file>] [-os <goos>]            the service file for this system
  arrowloop hash-password                                     the value for ARROWLOOP_PASSWORD_HASH
  arrowloop serve-data [-read-only] [-adopt] [-exit-on-eof]   serve Android/data to the phone app's engine
  arrowloop version                                           which build this is

Every command takes -h for its own flags.
`

// Options are what the program running the commands decides for itself.
type Options struct {
	// Config is the configuration file a command reads when -config names
	// none.
	Config string
	// Remotes points rclone at the storage targets that go with the
	// configuration file at path.
	Remotes func(path string) error

	Stdout, Stderr io.Writer
}

// Engine is how the engine binary runs: the configuration in the working
// directory, the storage targets beside it.
func Engine() Options {
	return Options{Config: "arrowloop.json", Remotes: remotes.Use, Stdout: os.Stdout, Stderr: os.Stderr}
}

type command func(o Options, ctx context.Context, args []string) error

var commands = map[string]command{
	"sync":          func(_ Options, ctx context.Context, args []string) error { return cmdSync(ctx, args) },
	"run":           Options.cmdRun,
	"run-due":       Options.cmdRunDue,
	"web":           Options.cmdWeb,
	"daemon":        Options.cmdDaemon,
	"jobs":          Options.cmdJobs,
	"history":       Options.cmdHistory,
	"service":       func(o Options, _ context.Context, args []string) error { return o.cmdService(args) },
	"healthcheck":   func(_ Options, ctx context.Context, args []string) error { return cmdHealth(ctx, args) },
	"hash-password": func(o Options, _ context.Context, args []string) error { return o.cmdHashPassword(args) },
	"serve-data":    func(_ Options, _ context.Context, args []string) error { return cmdServeData(args) },
	"version":       printVersion,
	"-version":      printVersion,
	"--version":     printVersion,
	"help":          printUsage,
}

// IsCommand reports whether name is one of the commands, so a program that
// does something else without one can tell a command from its own flags.
func IsCommand(name string) bool {
	_, ok := commands[name]
	return ok
}

// Main runs the command args names and returns the exit code: 0 when it
// worked, 1 when it did not, 2 for a command line it could not make sense of,
// and 128 plus the signal's number for a run stopped by Ctrl+C or the service
// manager.
func Main(args []string, o Options) int {
	if len(args) == 0 {
		fmt.Fprint(o.Stderr, usage)
		return 2
	}

	// Before anything opens a connection or reads a clock (see android.go).
	applyAndroidEnvironment()

	// Before anything creates a file, the configuration and state databases
	// included.
	if err := applyUmask(umaskSetting()); err != nil {
		fmt.Fprintln(o.Stderr, err)
		return 2
	}

	// rclone reads its own config for named remotes such as "sftp:backup". A
	// job using plain paths never needs it.
	configfile.Install()

	name := args[0]
	if name == "-h" || name == "--help" {
		name = "help"
	}
	run, ok := commands[name]
	if !ok {
		fmt.Fprintf(o.Stderr, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
	err := run(o, context.Background(), args[1:])
	var stopped interrupted
	var wrong usageError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &stopped):
		fmt.Fprintln(o.Stderr, err)
		return stopped.exitCode()
	case errors.Is(err, errShown):
		return 2
	case errors.As(err, &wrong):
		fmt.Fprintln(o.Stderr, "error:", err)
		return 2
	default:
		fmt.Fprintln(o.Stderr, "error:", err)
		return 1
	}
}

// printVersion prints the build alone, since the binary has no Windows
// version resource and the banner only prints on `web`.
func printVersion(o Options, _ context.Context, _ []string) error {
	_, err := fmt.Fprintln(o.Stdout, boot.Version)
	return err
}

func printUsage(o Options, _ context.Context, _ []string) error {
	_, err := fmt.Fprint(o.Stdout, usage)
	return err
}

// usageError is a command line that names something that is not there.
type usageError struct{ error }

// errShown is a usage error the flag package has already printed.
var errShown = usageError{errors.New("bad flags")}

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
