package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/service"
)

// load reads the configuration and starts the process-wide accounting, which
// the bandwidth limit needs.
func (o Options) load(ctx context.Context, path string) (*job.Config, error) {
	// Storage targets live beside the configuration rather than at rclone's
	// default, which inside a container is not on a mounted volume (see
	// internal/remotes/where.go).
	if err := o.Remotes(path); err != nil {
		return nil, fmt.Errorf("decide where the storage targets live: %w", err)
	}

	cfg, err := job.Load(path)
	if err != nil {
		return nil, err
	}
	// Settings the file still carries but this version ignores are named, so
	// nobody believes they are in force.
	if gone := cfg.Retired(); len(gone) > 0 {
		fmt.Fprintf(o.Stderr,
			"note: %s carries settings this version no longer has and ignored them: %s\n",
			path, strings.Join(gone, ", "))
	}
	for _, j := range cfg.Jobs {
		if err := j.Refused(); err != nil {
			fmt.Fprintf(o.Stderr, "note: %v; the other jobs run as usual\n", err)
		}
	}
	if err := engine.StartAccounting(ctx, cfg.BwLimit); err != nil {
		return nil, err
	}
	return cfg, nil
}

func logf(format string, args ...any) {
	fmt.Printf("%s  %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

// progress is logf for a command whose standard output is its result, so a
// script reading the result does not get the log mixed in.
func (o Options) progress(format string, args ...any) {
	fmt.Fprintf(o.Stderr, "%s  %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

// summary is the one line a finished run is worth.
func summary(rec history.Run) string {
	return fmt.Sprintf("%s: %d copied, %d moved, %d trashed, %d conflicts, %d folders made, %d folders removed, %d unchanged, %d left for later, in %s",
		rec.Job, rec.Copied, rec.Moved, rec.Trashed, rec.Conflicts, rec.DirsMade, rec.DirsRemoved,
		rec.Unchanged, rec.Skipped, rec.Finished.Sub(rec.Started).Round(time.Millisecond))
}

// cmdRun executes one named job immediately, whatever its schedule says.
func (o Options) cmdRun(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("run", flag.ExitOnError)
	configPath := fset.String("config", o.Config, "the configuration file")
	verbose := fset.Bool("v", false, "let rclone report what it is doing underneath")
	if err := fset.Parse(args); err != nil {
		return err
	}
	if fset.NArg() != 1 {
		return errors.New("name exactly one job to run")
	}
	quieten(ctx, *verbose)

	cfg, err := o.load(ctx, *configPath)
	if err != nil {
		return err
	}
	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		return err
	}
	defer hist.Close()

	ctx, stop := stopOnSignal(ctx)
	defer stop()
	runner := daemon.New(cfg, hist, o.progress)
	closeVPN, err := withVPN(runner, *configPath, o.progress)
	if err != nil {
		return err
	}
	defer closeVPN()
	rec, err := runner.Run(ctx, fset.Arg(0))
	if cause := context.Cause(ctx); errors.As(cause, new(interrupted)) {
		return cause
	}
	if err != nil {
		return err
	}
	fmt.Fprintln(o.Stdout, summary(rec))
	return nil
}

// cmdDaemon runs every scheduled job until it is asked to stop.
func (o Options) cmdDaemon(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("daemon", flag.ExitOnError)
	configPath := fset.String("config", o.Config, "the configuration file")
	keepFlag := fset.Duration("keep-history", 0, "how long to keep run records instead of historyKeep, 0 keeps them forever")
	verbose := fset.Bool("v", false, "let rclone report what it is doing underneath")
	if err := fset.Parse(args); err != nil {
		return err
	}
	quieten(ctx, *verbose)

	cfg, err := o.load(ctx, *configPath)
	if err != nil {
		return err
	}
	cfg = cfg.StateByID(logf)
	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		return err
	}
	defer hist.Close()
	keep, prune := cfg.KeepHistoryFor()
	fset.Visit(func(f *flag.Flag) {
		if f.Name == "keep-history" {
			keep, prune = *keepFlag, *keepFlag > 0
		}
	})
	if prune {
		if n, err := hist.Prune(ctx, keep, time.Now()); err != nil {
			logf("could not prune the run log: %v", err)
		} else if n > 0 {
			logf("dropped %d run records older than %s", n, keep)
		}
	}

	// Stopping on a signal keeps a shutdown from killing a transfer halfway.
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	runner := daemon.New(cfg, hist, logf)
	closeVPN, err := withVPN(runner, *configPath, logf)
	if err != nil {
		return err
	}
	defer closeVPN()
	if ready, _ := daemon.Reporting(cfg); len(ready) > 0 {
		names := make([]string, len(ready))
		for i, c := range ready {
			names[i] = daemon.ChannelName(c) + " (" + string(c.Kind) + ")"
		}
		logf("reporting to %s", strings.Join(names, ", "))
	}
	logf("watching %d job(s), %d at a time", len(cfg.Jobs), cfg.ParallelJobs)
	err = runner.Serve(ctx)
	stopping, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	runner.StopAll(stopping)
	return err
}

// cmdJobs lists what the configuration defines and when each job last
// succeeded, since a job that fails every run still looks busy in a log.
func (o Options) cmdJobs(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("jobs", flag.ExitOnError)
	configPath := fset.String("config", o.Config, "the configuration file")
	if err := fset.Parse(args); err != nil {
		return err
	}
	cfg, err := job.Load(*configPath)
	if err != nil {
		return err
	}
	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		return err
	}
	defer hist.Close()

	w := tabwriter.NewWriter(o.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "JOB\tSCHEDULE\tLEFT\tRIGHT\tLAST SUCCESS")
	for _, j := range cfg.Jobs {
		schedule := j.Schedule
		if schedule == "" {
			schedule = "on request"
		}
		if j.Disabled {
			schedule = "disabled"
		}
		last := "never"
		if when, ok, err := hist.LastSuccess(ctx, j.Key()); err == nil && ok {
			last = when.Format("2006-01-02 15:04")
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", j.Name, schedule, j.Left, j.Right, last)
	}
	return w.Flush()
}

// cmdHistory prints what the runs did.
func (o Options) cmdHistory(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("history", flag.ExitOnError)
	configPath := fset.String("config", o.Config, "the configuration file")
	which := fset.String("job", "", "only this job, by its name or its id")
	limit := fset.Int("limit", 20, "how many runs to show")
	if err := fset.Parse(args); err != nil {
		return err
	}
	cfg, err := job.Load(*configPath)
	if err != nil {
		return err
	}
	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		return err
	}
	defer hist.Close()

	key := *which
	if j, ok := cfg.Find(key); ok {
		key = j.Key()
	}
	runs, err := hist.Recent(ctx, key, history.ShowAll, *limit)
	if err != nil {
		return err
	}
	if len(runs) == 0 {
		fmt.Fprintln(o.Stdout, "no runs recorded yet")
		return nil
	}

	w := tabwriter.NewWriter(o.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "WHEN\tJOB\tTOOK\tCOPIED\tMOVED\tTRASHED\tCONFLICTS\tLATER\tRESULT")
	for _, r := range runs {
		result := "ok"
		if r.Failed() {
			result = r.Err
		} else if r.Stopped {
			result = "stopped"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%s\n",
			r.Started.Format("2006-01-02 15:04:05"), r.Job,
			r.Finished.Sub(r.Started).Round(time.Millisecond),
			r.Copied, r.Moved, r.Trashed, r.Conflicts, r.Skipped, result)
	}
	return w.Flush()
}

// cmdService prints the file this operating system wants in order to keep the
// daemon running, and the command that switches it on (see package service).
func (o Options) cmdService(args []string) error {
	fset := flag.NewFlagSet("service", flag.ExitOnError)
	configPath := fset.String("config", o.Config, "the configuration file the service should use")
	goos := fset.String("os", "", "produce the file for another system: linux, darwin or windows")
	if err := fset.Parse(args); err != nil {
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find this program's own path: %w", err)
	}
	// The service manager starts the daemon in some other directory.
	abs, err := filepath.Abs(*configPath)
	if err != nil {
		return fmt.Errorf("resolve %q: %w", *configPath, err)
	}

	var def service.Definition
	if *goos == "" {
		def, err = service.Current(exe, abs)
	} else {
		def, err = service.For(*goos, exe, abs)
	}
	if err != nil {
		return err
	}
	fmt.Fprint(o.Stdout, def.String())
	return nil
}
