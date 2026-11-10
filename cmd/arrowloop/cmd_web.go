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
	"runtime"
	"syscall"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/lan"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/hold"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/security"
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
	linkAppData(filepath.Dir(*configPath))
	linkAppDocs(filepath.Dir(*configPath))
	// Read before anything listens, so a damaged file stops the start instead
	// of serving an install whose password has gone missing.
	key, err := security.LoadKey(*configPath)
	if err != nil {
		return err
	}
	secured, err := security.Open(*configPath, key)
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

	runner := daemon.New(cfg, hist, logf)

	ui, err := webui.Files()
	if err != nil {
		return fmt.Errorf("read the built interface: %w", err)
	}
	// Receives the phone's reports about battery and metered connections. The
	// container never gets one, which costs nothing.
	held := hold.New()
	runner.SetCondition(held.Condition())
	if file := os.Getenv(accessVar); file != "" {
		runner.SetAccess(fileAccess(file))
	}

	paired, err := pairing.Open(filepath.Dir(*configPath), key)
	if err != nil {
		return err
	}

	server := &web.Server{
		History:     hist,
		Runner:      runner,
		UI:          ui,
		Placeholder: webui.Placeholder,
		Hold:        held,
		Security:    secured,
		Key:         key,
		Log:         logf,
		Pairing:     paired,
		Deployment:  deployment(),
	}

	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", *addr, err)
	}
	// An instance only its own machine reaches calls the others directly once
	// it knows their address, and announces nothing of its own.
	if direct := directURL(listener.Addr()); direct != "" {
		network := lan.New(lan.Config{Group: lanGroup, Ports: []int{defaultPort}})
		network.Start()
		defer network.Close()
		server.LAN, server.DirectURL = network, direct
	}
	boot.Banner()

	httpServer := newHTTPServer(server.Guard(server.Handler()))

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

	server.StartPairing()
	defer server.StopPairing()
	go server.WatchReleases(ctx)

	boot.Ready(fmt.Sprintf("http://%s", listener.Addr()))

	var served error
	select {
	case served = <-errs:
	case <-ctx.Done():
	}

	// The runs first: their records are what a container's short notice
	// before the kill is worth spending on.
	stopping, cancelStop := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancelStop()
	runner.StopAll(stopping)
	if served != nil {
		return served
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdown)
}

func newHTTPServer(handler http.Handler) *http.Server {
	// Shutdown waits for every handler to return but cancels none of them,
	// so the events stream would hold it until its timeout.
	requests, cancel := context.WithCancel(context.Background())
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		// No write timeout: the events endpoint is a stream that stays open for
		// as long as somebody is watching, and a write deadline would cut it.
		BaseContext: func(net.Listener) context.Context { return requests },
	}
	server.RegisterOnShutdown(cancel)
	return server
}

// shutdownGrace is how long a shutdown waits for a stopped run to record
// itself. Docker allows ten seconds before it kills; a run that takes longer
// is recorded as interrupted at the next start.
const shutdownGrace = 8 * time.Second

// starterConfig is what a first run writes when there is no configuration yet:
// no jobs, so a new installation does nothing until one is set up.
const starterConfig = `{
  "jobs": []
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

// deployment is what this instance tells the others of its group it is. The
// phone app starts this same command, and a container has Docker's marker
// file at its root.
func deployment() string {
	if runtime.GOOS == "android" {
		return "phone"
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "container"
	}
	return "server"
}
