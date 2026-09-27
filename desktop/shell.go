package main

import (
	"context"
	"log"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// A click on the tray icon takes the focus from the small window, which hides
// it, before the click itself arrives. A click this soon after is the one that
// hid it, and means close rather than open again.
const refocusGrace = 400 * time.Millisecond

// trayGap is the room between the small window and the taskbar or the icon.
const trayGap = 8

// shell is everything the desktop adds around the engine: the main window, the
// small window at the tray icon, and the icon with its menu.
type shell struct {
	ctx      context.Context
	app      *application.App
	store    *deskset.Store
	runner   *daemon.Runner
	main     *application.WebviewWindow
	activity *application.WebviewWindow
	live     *TrayLive

	// Unix nanoseconds, read on the main thread, which must not wait on mu.
	activityHid atomic.Int64

	mu         sync.Mutex
	tray       *application.SystemTray
	trayHidden bool
	pause      *application.MenuItem
	items      trayItems
	paused     bool
}

// trayItems are the menu entries whose words follow the interface's language.
type trayItems struct {
	open, syncNow, quit *application.MenuItem
}

func newShell(ctx context.Context, app *application.App, store *deskset.Store, icons *TraySet) *shell {
	s := &shell{ctx: ctx, app: app, store: store, live: newTrayLive(icons)}

	s.main = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "main",
		Title:  "ArrowLoop",
		Width:  1100,
		Height: 760,
		URL:    "/",
	})
	s.main.RegisterHook(events.Common.WindowClosing, s.closing)
	s.main.OnWindowEvent(events.Common.WindowMinimise, func(*application.WindowEvent) {
		if set := s.store.Get(); set.Tray && set.MinimiseToTray {
			s.main.Hide()
		}
	})

	// The interface reads the query and draws its compact view.
	s.activity = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:          "activity",
		Title:         "ArrowLoop",
		Width:         360,
		Height:        480,
		URL:           "/?view=activity",
		Frameless:     true,
		AlwaysOnTop:   true,
		Hidden:        true,
		DisableResize: true,
		HideOnEscape:  true,
		Windows:       application.WindowsWindow{HiddenOnTaskbar: true},
	})
	// Alt+F4 on the small window would otherwise destroy it for good.
	s.activity.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if s.ending() {
			return
		}
		e.Cancel()
		s.activity.Hide()
	})
	// A hidden window stays the foreground one until something else takes
	// over, and losing that must not count as the click that closed it.
	s.activity.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) {
		if !s.activity.IsVisible() {
			return
		}
		s.activityHid.Store(time.Now().UnixNano())
		s.activity.Hide()
	})

	store.Watch(s.follow)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		s.follow()
	})
	return s
}

// ending reports whether the program is on its way out, when every window
// closes for real.
func (s *shell) ending() bool { return s.app.Context().Err() != nil }

// closing decides what the main window's close button does.
func (s *shell) closing(e *application.WindowEvent) {
	if s.ending() {
		return
	}
	e.Cancel()
	if set := s.store.Get(); set.Tray && set.CloseToTray {
		s.main.Hide()
		return
	}
	s.app.Quit()
}

// showMain brings the main window back from the tray, the taskbar or behind
// other windows. Focus also restores a window that was hidden while minimised.
func (s *shell) showMain() {
	s.activity.Hide()
	s.main.Show()
	s.main.Focus()
}

// follow brings the icon, the menu and the runs in line with the settings. It
// runs at start and after every change, from whichever goroutine made it.
func (s *shell) follow() {
	set := s.store.Get()
	words := s.store.Words()

	s.mu.Lock()
	justPaused := set.Paused && !s.paused
	s.paused = set.Paused
	// Hiding keeps the icon's identity, and with it the place somebody gave it
	// in the notification area. Linux cannot hide an icon, so there it goes
	// and comes back as a new one.
	switch {
	case set.Tray && s.tray == nil:
		s.tray = s.startTray()
		s.live.attach(s.tray)
	case set.Tray && s.trayHidden:
		s.tray.Show()
		s.trayHidden = false
	case !set.Tray && s.tray != nil && !s.trayHidden:
		s.activity.Hide()
		if runtime.GOOS == "linux" {
			s.live.attach(nil)
			s.tray.Destroy()
			s.tray = nil
		} else {
			s.tray.Hide()
			s.trayHidden = true
		}
	}
	if s.tray != nil {
		s.items.open.SetLabel(words.Open)
		s.items.syncNow.SetLabel(words.SyncNow)
		s.items.quit.SetLabel(words.Quit)
		if set.Paused {
			s.pause.SetLabel(words.Resume)
		} else {
			s.pause.SetLabel(words.Pause)
		}
	}
	s.mu.Unlock()

	s.live.show(set.Paused, words)

	// A run already going is automatic work too, and pausing means it stops.
	if justPaused {
		for name := range s.runner.Running() {
			s.runner.Cancel(name)
		}
	}
}

// startTray puts the icon in the notification area. A click opens the small
// window at the icon, a double click the main window, a right click the menu.
// The caller holds mu.
func (s *shell) startTray() *application.SystemTray {
	menu := s.app.NewMenu()
	s.items.open = menu.Add("").OnClick(func(*application.Context) { s.showMain() })
	s.items.syncNow = menu.Add("").OnClick(func(*application.Context) { syncAll(s.ctx, s.runner) })
	s.pause = menu.Add("").OnClick(func(*application.Context) {
		if err := s.store.SetPaused(!s.store.Get().Paused); err != nil {
			log.Printf("tray: %v", err)
		}
	})
	menu.AddSeparator()
	s.items.quit = menu.Add("").OnClick(func(*application.Context) { s.app.Quit() })

	tray := s.app.SystemTray.New()
	tray.SetMenu(menu)
	tray.SetIcon(s.live.set.Idle)
	tray.SetTooltip("ArrowLoop")
	tray.OnClick(func() { s.toggleActivity(tray) })
	// By the time a double click arrives, its first click has opened the small
	// window and its second has closed it again.
	tray.OnDoubleClick(s.showMain)
	// A right click keeps Wails' own handler. The tray runs as soon as New
	// returns, and SetMenu on a running tray reaches the menu that handler
	// opens but not the one OpenMenu checks.
	return tray
}

// toggleActivity opens the small window at the icon, or closes it. It runs on
// the main thread.
func (s *shell) toggleActivity(tray *application.SystemTray) {
	if s.activity.IsVisible() {
		s.activity.Hide()
		return
	}
	if time.Since(time.Unix(0, s.activityHid.Load())) < refocusGrace {
		return
	}
	if err := tray.PositionWindow(s.activity, trayGap); err != nil {
		log.Printf("tray: place the window at the icon: %v", err)
	}
	clearTaskbar(s.activity, trayGap)
	s.activity.Show().Focus()
}

// syncAll starts every job that can run, as if each had been started by hand,
// so no condition and no pause holds it.
func syncAll(ctx context.Context, runner *daemon.Runner) {
	for _, name := range startable(runner.Config().Jobs, runner.Running()) {
		go func() {
			if _, err := runner.Run(ctx, name); err != nil {
				log.Printf("tray: %s: %v", name, err)
			}
		}()
	}
}

// startable is every job Force sync starts: switched on, both sides set, and
// not already running.
func startable(jobs []job.Job, running map[string]bool) []string {
	var out []string
	for _, j := range jobs {
		if j.Disabled || j.Left == "" || j.Right == "" || running[j.Name] {
			continue
		}
		out = append(out, j.Name)
	}
	return out
}
