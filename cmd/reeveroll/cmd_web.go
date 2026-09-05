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
	"syscall"
	"time"

	"github.com/junkerderprovinz/reeveroll/internal/daemon"
	"github.com/junkerderprovinz/reeveroll/internal/history"
	"github.com/junkerderprovinz/reeveroll/internal/web"
	webui "github.com/junkerderprovinz/reeveroll/web"
)

// cmdWeb serves the interface and, unless told otherwise, runs the schedules
// alongside it.
//
// One process rather than two: a browser tab that can start a job but cannot
// see the scheduled ones would be lying by omission, and two processes sharing
// one state database is the sort of arrangement that works until the day both
// happen to run the same job.
func cmdWeb(ctx context.Context, args []string) error {
	fset := flag.NewFlagSet("web", flag.ExitOnError)
	configPath := fset.String("config", defaultConfig, "the configuration file")
	addr := fset.String("addr", "127.0.0.1:8422", "address to listen on")
	noSchedule := fset.Bool("no-schedule", false, "serve the interface only, do not run the schedules")
	verbose := fset.Bool("v", false, "let rclone report what it is doing underneath")
	if err := fset.Parse(args); err != nil {
		return err
	}
	quieten(ctx, *verbose)

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
	server := &web.Server{Config: cfg, History: hist, Runner: runner, UI: ui}

	// The default address is loopback on purpose. This interface can start a
	// job that deletes files, and it has no login of its own; putting it on
	// 0.0.0.0 by default would hand that to anybody on the network. Someone who
	// wants it reachable can say so, and should put it behind something that
	// asks who they are.
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", *addr, err)
	}
	logf("interface on http://%s", listener.Addr())

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

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}

	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdown)
}
