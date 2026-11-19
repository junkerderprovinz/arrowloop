package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// cmdRunDue runs every job whose schedule is due, one after another, and
// exits. It is for a machine where cron, Task Scheduler or a systemd timer
// starts the program at intervals instead of the program staying up.
func (o Options) cmdRunDue(ctx context.Context, args []string) error {
	ctx, stop := stopOnSignal(ctx)
	defer stop()
	err := o.runDue(ctx, args)
	if cause := context.Cause(ctx); errors.As(cause, new(interrupted)) {
		return cause
	}
	return err
}

func (o Options) runDue(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("run-due", flag.ContinueOnError)
	fset.SetOutput(o.Stderr)
	configPath := fset.String("config", o.Config, "the configuration file")
	verbose := fset.Bool("v", false, "let rclone report what it is doing underneath")
	if err := fset.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return errShown
	}
	if fset.NArg() > 0 {
		return usageError{errors.New("run-due takes no job names; it runs whichever jobs are due, and `run` runs one by name")}
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

	due := daemon.New(cfg, hist, o.progress).RunDue(ctx)
	failed := 0
	for _, j := range due.Jobs {
		switch {
		case j.Run.Stopped:
			fmt.Fprintf(o.Stdout, "%s: stopped\n", j.Job)
			failed++
		case j.Skipped():
			fmt.Fprintf(o.Stdout, "%s: skipped, %v\n", j.Job, j.Err)
		case j.Err != nil:
			fmt.Fprintf(o.Stdout, "%s: failed, %v\n", j.Job, j.Err)
			failed++
		default:
			fmt.Fprintln(o.Stdout, summary(j.Run))
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d due jobs did not succeed", failed, len(due.Jobs))
	}
	return nil
}

// stopOnSignal cancels ctx on Ctrl+C or a stop from the service manager, with
// the signal as the cause, so a run in progress unwinds and is recorded as
// stopped.
func stopOnSignal(ctx context.Context) (context.Context, func()) {
	ctx, cancel := context.WithCancelCause(ctx)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() {
		select {
		case s := <-signals:
			cancel(interrupted{s.(syscall.Signal)})
		case <-ctx.Done():
		}
	}()
	return ctx, func() {
		signal.Stop(signals)
		cancel(nil)
	}
}

// interrupted is a command stopped by a signal. It exits the way a shell
// reports a process the signal ended, 130 for Ctrl+C and 143 for SIGTERM.
type interrupted struct{ sig syscall.Signal }

func (i interrupted) Error() string { return "stopped: " + i.sig.String() }

func (i interrupted) exitCode() int { return 128 + int(i.sig) }
