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
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/energye/systray"

	// Only the backends this stage needs, exactly as the command line binary
	// does. Importing backend/all would multiply the download for targets
	// nobody has asked for.
	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"

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

// The interface is embedded here as well as in the command line binary. Wails
// wants its own copy at build time, and a build tag sharing one directory
// between two modules is more machinery than a second embed directive.
//
//go:embed all:frontend/dist
var assets embed.FS

// The icon the notification area draws. The same file the executable and the
// installer wear, so the three cannot drift into showing different marks for
// the same program.
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

	runner := daemon.New(cfg, hist, notifier(cfg), func(format string, args ...any) {
		log.Printf(format, args...)
	})

	ui, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return err
	}
	window := deskset.Open(configPath)
	server := &web.Server{
		History: hist, Runner: runner, UI: ui,
		Placeholder: webui.Placeholder,
		Window:      window,
	}

	// An autostart entry records a path, and a path is a promise about where
	// this file will still be in six months. Somebody who switched it on for a
	// portable copy and later installed the program properly has an entry
	// pointing at nothing, and it fails at a reboot without saying so. This
	// makes the entry follow the program instead.
	//
	// A warning rather than a refusal: the window opening matters more than the
	// entry being current, and the settings switch still reports the truth
	// either way.
	if err := autostart.Refresh(); err != nil {
		log.Printf("could not re-point the autostart entry: %v", err)
	}

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

	// Every icon the notification area will show, derived once from the one
	// embedded PNG. A failure here costs the spin and the colours, not the
	// program: the plain mark is still a working tray icon.
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
	live.Watch(ctx, runner)

	// Held so the second-instance handler can reach the window. Wails passes
	// the context to OnStartup and nowhere else, and that handler runs long
	// after this function has returned.
	var uiCtx context.Context

	return wails.Run(&options.App{
		Title:  "ArrowLoop",
		Width:  1100,
		Height: 760,
		// One copy at a time, and a second launch brings the first one back
		// rather than starting a race.
		//
		// Two copies cannot work anyway: they would share one WebView2 profile
		// and the second would fail to create its window with a bare
		// ERROR_BUSY and a twenty-two frame stack trace. They would also both
		// run the same schedules over the same state database. Double-clicking
		// an icon whose window is hidden in the notification area is the
		// obvious way to reach that, and it is also the obvious way somebody
		// expects to get their window back.
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.junkerderprovinz.arrowloop",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				if uiCtx != nil {
					show(uiCtx)
				}
			},
		},
		// The context arrives here and nowhere else, and everything that has to
		// reach the window runs long after this function returns, so both
		// helpers below are handed it rather than looking it up later.
		OnStartup: func(c context.Context) {
			uiCtx = c
			startTray(c, window, live)
			watchMinimise(c, window)
		},
		// What the close button does is a setting, and its default is that it
		// closes. A close button that quietly hides a running program is the
		// kind of surprise somebody discovers a week later, wondering why a job
		// keeps running; anybody who wants that behaviour can ask for it.
		OnBeforeClose: func(c context.Context) bool {
			if !window.Get().CloseToTray {
				return false
			}
			wruntime.WindowHide(c)
			return true
		},
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

// activityLines is how many running jobs the little panel names before it stops
// naming them.
//
// Six is more than anybody runs at once and few enough that the panel stays a
// panel. A tray menu that scrolls is a window, and a window is what the second
// entry opens.
const activityLines = 6

// startTray puts the program in the notification area, if it is wanted.
//
// The icon says what the program is doing without being asked: it turns while
// files move, goes green when a run settles and red when one fails. That is the
// entire reason a tray icon is worth having over a taskbar button, which can
// only ever say that the program exists.
//
// A left click opens a small panel with the current activity rather than the
// whole window, because "what is it doing right now" is a question somebody
// asks in the middle of something else. The window is one entry down for when
// the answer is worth acting on.
func startTray(ctx context.Context, window *deskset.Store, live *TrayLive) {
	if !window.Get().Tray {
		return
	}

	systray.Run(func() {
		systray.SetTitle("ArrowLoop")
		systray.SetTooltip("ArrowLoop")
		systray.SetIcon(live.set.Idle)

		// The activity rows are built once and re-titled, because a systray menu
		// cannot grow or shrink after it has been shown: adding a row per event
		// would work on the first run and quietly stop working on the second.
		// Rows with nothing to say are hidden rather than blank.
		rows := make([]*systray.MenuItem, activityLines)
		for i := range rows {
			rows[i] = systray.AddMenuItem("", "")
			rows[i].Disable()
			rows[i].Hide()
		}
		systray.AddSeparator()

		open := systray.AddMenuItem("Open ArrowLoop", "Bring the window back")
		systray.AddSeparator()
		quit := systray.AddMenuItem("Quit", "Stop ArrowLoop and its schedules")

		fill := func() {
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

		// Both buttons open the panel, filled a moment before it is drawn: a
		// panel showing the state from whenever it was last opened is a panel
		// that lies, and this is the one thing it exists to be right about.
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

// watchMinimise sends a minimised window to the notification area when that is
// what somebody asked for.
//
// Polling rather than an event, because Wails v2 does not raise one for
// minimising: it exposes the window's state and nothing that fires when it
// changes. Half a second is slow enough to cost nothing and quick enough that
// the window does not sit visibly in the taskbar on its way out.
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
					// Unminimise first: a window hidden while minimised comes
					// back minimised, which looks like the tray icon did
					// nothing.
					wruntime.WindowUnminimise(ctx)
					wruntime.WindowHide(ctx)
				}
			}
		}
	}()
}
