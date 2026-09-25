// Command arrowloop-desktop is the same engine in a window. The scheduler, the
// run log and the API live in this process, so no server has to run elsewhere.
package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/energye/systray"

	// Every backend, as in cmd/arrowloop. remotes.Providers() offers only what
	// is registered, so a shorter list here would silently hide providers.
	_ "github.com/rclone/rclone/backend/all"

	"github.com/rclone/rclone/fs/config/configfile"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/junkerderprovinz/arrowloop/internal/autostart"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/notify"
	"github.com/junkerderprovinz/arrowloop/internal/web"
	webui "github.com/junkerderprovinz/arrowloop/web"
)

// Wails wants its own copy of the interface at build time.
//
//go:embed all:frontend/dist
var assets embed.FS

// The tray icon is the file the executable and the installer use, so all three
// show one mark.
//
//go:embed build/appicon.png
var trayIcon []byte

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

	desktopLog := func(format string, args ...any) {
		log.Printf(format, args...)
	}
	runner := daemon.New(cfg, hist, notifier(cfg), desktopLog)

	ui, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return err
	}
	window := deskset.Open(configPath)
	server := &web.Server{
		History: hist, Runner: runner, UI: ui,
		Placeholder: webui.Placeholder,
		Window:      window,
		Log:         desktopLog,
	}

	// An autostart entry records a path, which goes stale when the program
	// moves. A failure only warns: opening the window matters more.
	if err := autostart.Refresh(); err != nil {
		log.Printf("could not re-point the autostart entry: %v", err)
	}

	// The schedules run for as long as the program does; running after it
	// quits is what the daemon and the service files are for.
	go func() {
		if err := runner.Serve(ctx); err != nil {
			log.Printf("the scheduler stopped: %v", err)
		}
	}()

	// A failure costs the spin and the colours; the plain mark still works.
	icons, err := BuildTraySet(trayIcon)
	if err != nil {
		log.Printf("the tray icon has no states: %v", err)
		plain, wrapErr := icoFromPNG(trayIcon)
		if wrapErr != nil {
			plain = trayIcon
		}
		icons = &TraySet{Idle: plain, Settled: plain, Failed: plain, Working: [][]byte{plain}}
	}
	live := newTrayLive(icons)
	// Battery and metered-connection holds, nil where the platform cannot tell.
	runner.SetCondition(powerCondition(window))

	live.Watch(ctx, runner)

	// Wails passes the context only to OnStartup, and the second-instance
	// handler needs it later.
	var uiCtx context.Context

	return wails.Run(&options.App{
		Title:  "ArrowLoop",
		Width:  1100,
		Height: 760,
		// A second launch brings the first window back. Two copies would share
		// one WebView2 profile, where the second fails with ERROR_BUSY, and
		// would run the same schedules over the same state database.
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.junkerderprovinz.arrowloop",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				if uiCtx != nil {
					show(uiCtx)
				}
			},
		},
		OnStartup: func(c context.Context) {
			uiCtx = c
			startTray(c, window, live, runner)
			watchMinimise(c, window)
		},
		// Closing hides the window only when the setting asks for it.
		OnBeforeClose: func(c context.Context) bool {
			if !window.Get().CloseToTray {
				return false
			}
			wruntime.WindowHide(c)
			return true
		},
		// The API is the asset server's fallback handler, so nothing listens
		// on the network.
		AssetServer: &assetserver.Options{Assets: ui, Handler: server.Handler()},
	})
}

// configLocation returns the configuration path in the user's configuration
// directory, since an app installed under Program Files cannot write beside
// itself.
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

// activityLines is how many running jobs the tray panel names.
const activityLines = 6

// jobRow is one row of the tray's job block: what it says and what it starts.
// An empty name means the row is unused and hidden.
type jobRow struct {
	title string
	name  string
}

// jobRowTitles decides what each of the fixed rows carries. It is separate from
// the menu builder so it can be tested without a notification area.
func jobRowTitles(jobs []job.Job, rows int) []jobRow {
	out := make([]jobRow, rows)
	for i := range out {
		if i >= len(jobs) {
			continue
		}
		out[i] = jobRow{title: "Sync " + jobs[i].Name, name: jobs[i].Name}
	}
	return out
}

// jobLines is how many jobs the tray panel offers to start.
const jobLines = 12

// startTray puts the program in the notification area when the setting asks for
// it. The icon turns while files move and goes green or red when a run settles
// or fails; a click opens a small panel with the current activity and the jobs.
func startTray(ctx context.Context, window *deskset.Store, live *TrayLive, runner *daemon.Runner) {
	if !window.Get().Tray {
		return
	}

	systray.Run(func() {
		systray.SetTitle("ArrowLoop")
		systray.SetTooltip("ArrowLoop")
		systray.SetIcon(live.set.Idle)

		// A systray menu cannot grow or shrink after it has been shown, so the
		// rows are built once, re-titled, and hidden when unused.
		rows := make([]*systray.MenuItem, activityLines)
		for i := range rows {
			rows[i] = systray.AddMenuItem("", "")
			rows[i].Disable()
			rows[i].Hide()
		}
		systray.AddSeparator()

		jobRows := make([]*systray.MenuItem, jobLines)
		for i := range jobRows {
			jobRows[i] = systray.AddMenuItem("", "")
			jobRows[i].Hide()
		}
		systray.AddSeparator()

		open := systray.AddMenuItem("Open ArrowLoop", "Bring the window back")
		systray.AddSeparator()
		quit := systray.AddMenuItem("Quit", "Stop ArrowLoop and its schedules")

		// Which job each row stands for. A click can land while the menu is
		// being refilled.
		var namesMu sync.Mutex
		names := make([]string, jobLines)

		for i := range jobRows {
			// The index, not the name, since the name changes on every refill.
			at := i
			jobRows[at].Click(func() {
				namesMu.Lock()
				name := names[at]
				namesMu.Unlock()
				if name == "" {
					return
				}
				// Run rather than the automatic entry point: a click is the
				// decision a report-only job withholds from the clock.
				go func() {
					if _, err := runner.Run(ctx, name); err != nil {
						log.Printf("tray: %s: %v", name, err)
					}
				}()
			})
		}

		fill := func() {
			titles := jobRowTitles(runner.Config().Jobs, jobLines)
			namesMu.Lock()
			for i, row := range jobRows {
				names[i] = titles[i].name
				if titles[i].name == "" {
					row.Hide()
					continue
				}
				row.SetTitle(titles[i].title)
				row.Show()
			}
			namesMu.Unlock()

			lines := live.Activity()
			if len(lines) == 0 {
				lines = []string{"Nothing is running"}
			}
			for i, row := range rows {
				if i < len(lines) {
					row.SetTitle(lines[i])
					row.Show()
					continue
				}
				row.Hide()
			}
			if len(lines) > len(rows) {
				rows[len(rows)-1].SetTitle(fmt.Sprintf("and %d more", len(lines)-len(rows)+1))
			}
		}

		// Filled just before it is drawn, so the panel never shows stale state.
		systray.SetOnClick(func(menu systray.IMenu) {
			fill()
			_ = menu.ShowMenu()
		})
		systray.SetOnRClick(func(menu systray.IMenu) {
			fill()
			_ = menu.ShowMenu()
		})

		open.Click(func() { show(ctx) })
		quit.Click(func() {
			systray.Quit()
			wruntime.Quit(ctx)
		})
	}, nil)
}

func show(ctx context.Context) {
	wruntime.WindowUnminimise(ctx)
	wruntime.WindowShow(ctx)
}

// watchMinimise sends a minimised window to the notification area when the
// setting asks for it. It polls because Wails v2 raises no event for minimising.
func watchMinimise(ctx context.Context, window *deskset.Store) {
	go func() {
		tick := time.NewTicker(500 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if !window.Get().MinimiseToTray {
					continue
				}
				if wruntime.WindowIsMinimised(ctx) {
					// A window hidden while minimised comes back minimised.
					wruntime.WindowUnminimise(ctx)
					wruntime.WindowHide(ctx)
				}
			}
		}
	}()
}
