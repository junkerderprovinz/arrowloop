// Command arrowloop-desktop is the same engine in a window.
//
// It is not a client talking to a server: the scheduler, the run log and the
// API all live in this process, and the window is a webview pointed at them.
// That is what makes the desktop build worth having at all — a separate client
// would need a server to be running somewhere, which is exactly the setup step
// somebody installing a desktop app is trying to avoid.
package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	// Only the backends this stage needs, exactly as the command line binary
	// does. Importing backend/all would multiply the download for targets
	// nobody has asked for.
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"

	"github.com/rclone/rclone/fs/config/configfile"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/notify"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// The interface is embedded here as well as in the command line binary. Wails
// wants its own copy at build time, and a build tag sharing one directory
// between two modules is more machinery than a second embed directive.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx := context.Background()
	configfile.Install()

	configPath, err := configLocation()
	if err != nil {
		return err
	}
	if err := writeStarterConfig(configPath); err != nil {
		return err
	}

	cfg, err := job.Load(configPath)
	if err != nil {
		return err
	}
	if err := engine.StartAccounting(ctx, cfg.BwLimit); err != nil {
		return err
	}

	hist, err := history.Open(ctx, cfg.History)
	if err != nil {
		return err
	}
	defer hist.Close()

	runner := daemon.New(cfg, hist, notifier(cfg), func(format string, args ...any) {
		log.Printf(format, args...)
	})

	ui, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return err
	}
	server := &web.Server{History: hist, Runner: runner, UI: ui}

	// The schedules run for as long as the window is open. A desktop app that
	// only syncs while somebody is watching it would be a worse version of the
	// command line; one that keeps running after the window closes would be a
	// background service pretending to be an app. The daemon and the service
	// files exist for the second case.
	go func() {
		if err := runner.Serve(ctx); err != nil {
			log.Printf("the scheduler stopped: %v", err)
		}
	}()

	return wails.Run(&options.App{
		Title:  "ArrowLoop",
		Width:  1100,
		Height: 760,
		// The API is handed to the asset server as the fallback handler, so
		// /api/... reaches the engine and everything else is served from the
		// bundle. No second port, no loopback socket, and nothing listening on
		// the network at all: a desktop build that opened a port would be a
		// server somebody did not ask to run.
		AssetServer: &assetserver.Options{Assets: ui, Handler: server.Handler()},
	})
}

// configLocation puts the configuration where the operating system says user
// configuration goes, rather than beside the executable. An app installed under
// Program Files cannot write beside itself, and one that tried would fail in a
// way that looks like a permissions bug rather than a design mistake.
func configLocation() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("find the configuration directory: %w", err)
	}
	return filepath.Join(base, "ArrowLoop", "arrowloop.json"), nil
}

const starterConfig = `{
  "jobs": [
    {
      "name": "example",
      "disabled": true,
      "left": "",
      "right": "",
      "state": "state/example.db",
      "schedule": "*/15 * * * *"
    }
  ]
}
`

func writeStarterConfig(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(starterConfig), 0o644)
}

func notifier(cfg *job.Config) notify.Notifier {
	var out notify.Multi
	if m := cfg.Notify.Matrix; m != nil {
		out = append(out, &notify.Matrix{Homeserver: m.Homeserver, Room: m.Room, Token: m.Token})
	}
	if cfg.Notify.Webhook != "" {
		out = append(out, &notify.Webhook{URL: cfg.Notify.Webhook})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
