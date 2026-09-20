package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/hold"
	"github.com/junkerderprovinz/arrowloop/internal/web"
	webui "github.com/junkerderprovinz/arrowloop/web"
)

// cmdWeb serves the interface and, unless told otherwise, runs the schedules
// in the same process, so the interface sees the scheduled runs and no two
// processes share a state database.
func cmdWeb(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("web", flag.ExitOnError)
	configPath := fset.String("config", defaultConfig, "the configuration file")
	addr := fset.String("addr", defaultAddr(), "address to listen on")
	noSchedule := fset.Bool("no-schedule", false, "serve the interface only, do not run the schedules")
	verbose := fset.Bool("v", false, "let rclone report what it is doing underneath")
	if err := fset.Parse(args); err != nil {
		return err
	}
	quieten(ctx, *verbose)

	// A new container has an empty /config; failing on the missing file would
	// put it into a restart loop.
	if err := writeStarterConfig(*configPath); err != nil {
		return err
	}

	cfg, err := load(ctx, *configPath)
	if err != nil {
		return err
	}
	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		return err
	}
	defer hist.Close()

	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	runner := daemon.New(cfg, hist, notifier(cfg), logf)

	ui, err := webui.Files()
	if err != nil {
		return fmt.Errorf("read the built interface: %w", err)
	}
	// Receives the phone's reports about battery and metered connections. The
	// container never gets one, which costs nothing.
	held := hold.New()
	runner.SetCondition(held.Condition())

	server := &web.Server{
		History:     hist,
		Runner:      runner,
		UI:          ui,
		Placeholder: webui.Placeholder,
		Hold:        held,
		Log:         logf,
	}

	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", *addr, err)
	}
	boot.Banner()

	httpServer := &http.Server{
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// No write timeout: the events endpoint is a stream that stays open for
		// as long as somebody is watching, and a write deadline would cut it.
	}

	errs := make(chan error, 1)
	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()

	if !*noSchedule {
		go func() {
			if err := runner.Serve(ctx); err != nil {
				logf("the scheduler stopped: %v", err)
			}
		}()
	}

	boot.Ready(fmt.Sprintf("http://%s", listener.Addr()))

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdown)
}

// starterConfig is what a first run writes when there is no configuration yet.
// Its one job is disabled and points nowhere real, so a new installation does
// nothing until it is set up.
const starterConfig = `{
  "jobs": [
    {
      "name": "example",
      "disabled": true,
      "left": "/data/left",
      "right": "/data/right",
      "state": "state/example.db",
      "schedule": "*/15 * * * *",
      "exclude": [],
      "emptyDirs": false
    }
  ]
}
`

func writeStarterConfig(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("look for %s: %w", path, err)
	}
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	if err := os.WriteFile(path, []byte(starterConfig), 0o644); err != nil {
		return fmt.Errorf("write a starter configuration to %s: %w", path, err)
	}
	logf("no configuration found, wrote a starter one to %s", path)
	return nil
}
