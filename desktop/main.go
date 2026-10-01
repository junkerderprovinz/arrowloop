// Command arrowloop-desktop is the same engine in a window. The scheduler, the
// run log and the API live in this process, so no server has to run elsewhere.
package main

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"

	// Every backend, as in cmd/arrowloop. remotes.Providers() offers only what
	// is registered, so a shorter list here would silently hide providers.
	_ "github.com/rclone/rclone/backend/all"

	"github.com/rclone/rclone/fs/config/configfile"

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

// The tray icon is the file the executable and the installer use, so all three
// show one mark.
//
//go:embed build/appicon.png
var appIcon []byte

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	custom := flag.String("config", "", "the configuration file to use instead of the one in the user's configuration directory")
	scheduled := flag.Bool("update", false, "update the copy installed for all users and exit, as the installer's scheduled task does")
	startInTray := flag.Bool(autostart.Flag, false, "start in the notification area, as the program does when it starts with the session")
	flag.Parse()

	if *scheduled {
		return updateInstalled()
	}

	configPath, err := configLocation(*custom)
	if err != nil {
		return err
	}

	// Filled in below, once this is known to be the only copy. The windows
	// load nothing before app.Run.
	var api http.Handler
	var sh *shell

	opts := application.Options{
		Name:        "ArrowLoop",
		Description: "Two-way file synchronisation that shows you the plan before it moves anything.",
		Icon:        appIcon,
		// A second launch brings the first window back. Two copies would share
		// one WebView2 profile and run the same schedules over the same state
		// database.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: instanceID(*custom, configPath),
			OnSecondInstanceLaunch: func(second application.SecondInstanceData) {
				// The session starting the program finds it already running.
				if askedForTray(second.Args) {
					return
				}
				sh.showMain()
			},
		},
		// The tray window outlives the main one, so the main window's close
		// button decides alone whether the program ends.
		Windows: application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
		Linux:   application.LinuxOptions{DisableQuitOnLastWindowClosed: true, ProgramName: "ArrowLoop"},
		// The API is the whole asset server, the interface included, so
		// nothing listens on the network.
		Assets: application.AssetOptions{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { api.ServeHTTP(w, r) }),
		},
	}
	// Another configuration is another profile, whose interface settings must
	// not mix with the installed copy's.
	if *custom != "" {
		opts.Windows.WebviewUserDataPath = filepath.Join(filepath.Dir(configPath), "webview")
	}
	app := application.New(opts)

	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	// Before the engine starts, which takes a moment, so a second launch in
	// that moment finds a window to bring back.
	window := deskset.Open(configPath)
	installed := isInstalled()
	if installed {
		if dir, err := machineData(); err == nil {
			window.KeepAutoUpdateIn(filepath.Join(dir, machineSettingsFile))
		}
	}
	// Without the icon a hidden window would have no way back.
	inTray := window.Get().Tray && (*startInTray || window.InTray())
	sh = newShell(ctx, app, window, trayIcons(), inTray)

	configfile.Install()

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
	sh.runner = runner

	ui, err := webui.Files()
	if err != nil {
		return err
	}
	api = (&web.Server{
		History: hist, Runner: runner, UI: ui,
		Placeholder: webui.Placeholder,
		Window:      window,
		OpenWindow:  sh.showMain,
		Log:         desktopLog,
	}).Handler()

	// An autostart entry records a path, which goes stale when the program
	// moves. A failure only warns: opening the window matters more.
	if err := autostart.Refresh(); err != nil {
		log.Printf("could not re-point the autostart entry: %v", err)
	}

	// The tray's pause first, then battery and metered connections where the
	// platform can tell.
	runner.SetCondition(pausable(window, powerCondition(window)))

	// The schedules run for as long as the program does; running after it
	// quits is what the daemon and the service files are for.
	go func() {
		if err := runner.Serve(ctx); err != nil {
			log.Printf("the scheduler stopped: %v", err)
		}
	}()
	sh.live.Watch(ctx, runner)
	newBridge().run(ctx, runner, app)

	// A newer release is downloaded in the background and starts next time;
	// see updates.go. The installed copy leaves that to the installer's
	// scheduled task and only passes on the news.
	announce := func(version string) {
		app.Event.Emit(updateReadyEvent, version)
	}
	var up *updater
	if installed {
		up = newUpdater(window, log.Default(), announce)
		go up.follow(ctx)
	} else {
		up = newUpdater(window, openUpdateLog(filepath.Join(filepath.Dir(configPath), "update.log")), announce)
		go up.run(ctx)
	}

	// Quitting is a decision, and the next start shows the window again. Only a
	// program ended without the chance to get here comes back in the tray.
	app.OnShutdown(func() {
		stop()
		up.stop()
		sh.remember(false)
	})
	return app.Run()
}

// askedForTray reports whether a command line carries the flag the autostart
// entry adds, in either of the forms the flag package reads.
func askedForTray(args []string) bool {
	return slices.Contains(args, "--"+autostart.Flag) || slices.Contains(args, "-"+autostart.Flag)
}

// trayIcons builds every state of the tray icon. A failure costs the spin and
// the colours; the plain mark still works.
func trayIcons() *TraySet {
	icons, err := BuildTraySet(appIcon)
	if err != nil {
		log.Printf("the tray icon has no states: %v", err)
		return &TraySet{Idle: appIcon, Settled: appIcon, Failed: appIcon, Paused: appIcon, Working: [][]byte{appIcon}}
	}
	return icons
}

// configLocation returns the configuration path in the user's configuration
// directory, since an app installed under Program Files cannot write beside
// itself, unless one was given.
func configLocation(custom string) (string, error) {
	if custom != "" {
		return filepath.Abs(custom)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("find the configuration directory: %w", err)
	}
	return filepath.Join(base, "ArrowLoop", "arrowloop.json"), nil
}

// instanceID names the single-instance lock. A copy started on another
// configuration is a separate program and may run beside the installed one.
func instanceID(custom, configPath string) string {
	const id = "com.junkerderprovinz.arrowloop"
	if custom == "" {
		return id
	}
	sum := sha256.Sum256([]byte(configPath))
	return id + "." + hex.EncodeToString(sum[:4])
}

const starterConfig = `{
  "jobs": []
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
