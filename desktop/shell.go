package main

import (
	"context"
	"log"
	"net/url"
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

// A click on the tray icon takes the focus from the small window, which closes
// it, before the click itself arrives. A click this soon after is the one that
// closed it, and means close rather than open again.
const refocusGrace = 400 * time.Millisecond

// trayGap is the room between the small window and the taskbar or the icon.
const trayGap = 8

// shell is everything the desktop adds around the engine: the main window, the
// small window at the tray icon, and the icon with its menu.
//
// A window exists only while it is on screen. A webview kept hidden behind the
// icon holds a web process and its page, hundreds of megabytes for a program
// that mostly waits for the next schedule. The windows are made, closed and
// read on the main thread alone.
type shell struct {
	ctx    context.Context
	app    *application.App
	store  *deskset.Store
	runner *daemon.Runner
	live   *TrayLive
	lang   string
	// systemFrame is whether the window manager draws the main window's title
	// bar, which the page then leaves out.
	systemFrame bool

	main     *application.WebviewWindow
	activity *application.WebviewWindow
	// activityHid is when the small window last closed on losing the focus.
	activityHid time.Time
	// update is the version waiting for the next start that no main window
	// has been told of yet.
	update string

	// quitChosen is set when somebody quits from the menu or the close button,
	// rather than the installer or the session ending the program.
	quitChosen atomic.Bool

	// keep writes the small window's size once a drag on its edge stops, since
	// the drag sends a stream of resizes.
	keep *time.Timer

	mu         sync.Mutex
	resized    deskset.Size
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

// newShell sets up the windows. With inTray the program starts with none, its
// way to the main window being the icon. lang is the installer's language, or
// "".
func newShell(ctx context.Context, app *application.App, store *deskset.Store, icons *TraySet, inTray bool, lang string) *shell {
	s := &shell{ctx: ctx, app: app, store: store, live: newTrayLive(icons), lang: lang}
	s.systemFrame = runtime.GOOS == "linux" && systemDecorates()
	if !inTray {
		s.main = s.openMain()
	}
	s.remember(inTray)

	s.keep = time.AfterFunc(time.Hour, func() {
		s.mu.Lock()
		now := s.resized
		s.mu.Unlock()
		// Showing the window reports a resize too, which is not worth a write.
		if now != s.activitySize() {
			_ = store.SetActivitySize(now)
		}
	})
	s.keep.Stop()

	store.Watch(s.follow)
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		s.follow()
	})
	return s
}

// openMain makes the main window. It runs on the main thread, or before the
// program runs.
//
// On Windows and Linux the page draws the title bar in the house style
// (web/src/components/WindowFrame.tsx) and does the dragging and the edge
// resizing. Windows keeps the frame's shadow, rounded corners and snapping.
// macOS keeps its own title bar and the traffic lights people expect, and so
// does a Linux desktop whose window manager draws one regardless.
func (s *shell) openMain() *application.WebviewWindow {
	w := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "ArrowLoop",
		Width:     1100,
		Height:    760,
		URL:       pageURL("", s.lang, s.systemFrame),
		Frameless: runtime.GOOS != "darwin" && !s.systemFrame,
	})
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) { s.closing(w, e) })
	w.OnWindowEvent(events.Common.WindowMinimise, func(*application.WindowEvent) {
		if set := s.store.Get(); set.Tray && set.MinimiseToTray {
			s.toTray()
		}
	})
	// Wails holds the event until the page has loaded.
	if s.update != "" {
		s.app.Event.Emit(updateReadyEvent, s.update)
		s.update = ""
	}
	return w
}

// openActivity makes the small window, hidden until it has been placed at the
// icon. The interface reads the query and draws its compact view. It runs on
// the main thread.
func (s *shell) openActivity() *application.WebviewWindow {
	size := s.activitySize()
	w := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:        "activity",
		Title:       "ArrowLoop",
		Width:       size.Width,
		Height:      size.Height,
		MinWidth:    300,
		MinHeight:   360,
		URL:         pageURL("activity", s.lang, false),
		Frameless:   true,
		AlwaysOnTop: true,
		Hidden:      true,
		KeyBindings: map[string]func(application.Window){
			"escape": func(application.Window) { application.InvokeSync(s.closeActivity) },
		},
		Windows: application.WindowsWindow{HiddenOnTaskbar: true},
	})
	w.OnWindowEvent(events.Common.WindowDidResize, func(*application.WindowEvent) {
		width, height := w.Size()
		// Closed by the time the size was asked for.
		if width == 0 {
			return
		}
		s.mu.Lock()
		s.resized = deskset.Size{Width: width, Height: height}
		s.mu.Unlock()
		s.keep.Reset(time.Second)
	})
	// Alt+F4 closes it the way a click elsewhere does.
	w.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		if s.ending() {
			return
		}
		application.InvokeSync(func() {
			if s.activity == w {
				s.activity = nil
			}
		})
	})
	w.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) {
		application.InvokeSync(func() {
			if s.activity != w {
				return
			}
			s.activityHid = time.Now()
			s.closeActivity()
		})
	})
	return w
}

// activitySize is the small window's size as somebody last left it.
func (s *shell) activitySize() deskset.Size {
	if kept, ok := s.store.ActivitySize(); ok {
		return kept
	}
	return deskset.Size{Width: 360, Height: 480}
}

// closeActivity closes the small window if it is open. It runs on the main
// thread.
func (s *shell) closeActivity() {
	if w := s.activity; w != nil {
		s.activity = nil
		w.Close()
	}
}

// ending reports whether the program is on its way out, when every window
// closes for real.
func (s *shell) ending() bool { return s.app.Context().Err() != nil }

// closeOutcome is what a close of the main window leads to.
type closeOutcome int

const (
	// letClose lets the window go, as the shell itself asked.
	letClose closeOutcome = iota
	closeToTray
	quitProgram
)

// onClose decides what a close of the main window does. shown is whether the
// window is still the one on screen rather than one the shell is putting away.
func onClose(shown bool, set deskset.Settings) closeOutcome {
	switch {
	case !shown:
		return letClose
	case set.Tray && set.CloseToTray:
		return closeToTray
	default:
		return quitProgram
	}
}

// closing decides what the main window's close button does.
func (s *shell) closing(w *application.WebviewWindow, e *application.WindowEvent) {
	if s.ending() {
		return
	}
	shown := application.InvokeSyncWithResult(func() bool { return s.main == w })
	switch onClose(shown, s.store.Get()) {
	case closeToTray:
		e.Cancel()
		s.toTray()
	case quitProgram:
		e.Cancel()
		s.quit()
	}
}

// pageURL is the address a window opens. The interface draws its compact view
// for view=activity, starts in lang while nobody has picked a language in it,
// and leaves the title bar out for frame=system.
func pageURL(view, lang string, systemFrame bool) string {
	q := url.Values{}
	if view != "" {
		q.Set("view", view)
	}
	if systemFrame {
		q.Set("frame", "system")
	}
	if lang != "" {
		q.Set("lang", lang)
	}
	if len(q) == 0 {
		return "/"
	}
	return "/?" + q.Encode()
}

// quit ends the program because somebody chose to.
func (s *shell) quit() {
	s.quitChosen.Store(true)
	s.app.Quit()
}

// ended records the window's place for the next start. A quit somebody chose
// shows the window then; one from outside leaves it where it was, so a program
// the installer closes in the tray comes back there.
func (s *shell) ended() {
	if s.quitChosen.Load() {
		s.remember(false)
	}
}

// toTray closes the main window, leaving the icon as the way back.
func (s *shell) toTray() {
	application.InvokeSync(func() {
		if w := s.main; w != nil {
			s.main = nil
			w.Close()
		}
	})
	s.remember(true)
}

// showMain brings the main window back from the tray, the taskbar or behind
// other windows. Called before the program runs, it waits for it.
func (s *shell) showMain() {
	application.InvokeSync(func() {
		s.closeActivity()
		if s.main == nil {
			s.main = s.openMain()
		}
		s.main.Show()
		s.main.Focus()
	})
	s.remember(false)
}

// announce tells the main window which version waits for the next start, or
// keeps it for the next main window while there is none.
func (s *shell) announce(version string) {
	application.InvokeSync(func() {
		if s.main == nil {
			s.update = version
			return
		}
		s.app.Event.Emit(updateReadyEvent, version)
	})
}

// remember keeps where the main window is, so a program ended from outside
// while it sat in the tray, as an update ends it, starts there again.
func (s *shell) remember(inTray bool) {
	if err := s.store.SetInTray(inTray); err != nil {
		log.Printf("window: %v", err)
	}
}

// follow brings the icon, the menu and the runs in line with the settings. It
// runs at start and after every change, from whichever goroutine made it.
func (s *shell) follow() {
	set := s.store.Get()
	words := s.store.Words()

	var trayGone bool
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
		trayGone = true
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

	if trayGone {
		application.InvokeSync(s.closeActivity)
	}
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
	s.items.quit = menu.Add("").OnClick(func(*application.Context) { s.quit() })

	tray := s.app.SystemTray.New()
	tray.SetMenu(menu)
	tray.SetIcon(s.live.set.Idle)
	tray.SetTooltip("ArrowLoop")
	// Linux delivers the click on the D-Bus goroutine.
	tray.OnClick(func() { application.InvokeSync(func() { s.toggleActivity(tray) }) })
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
	if s.activity != nil {
		s.closeActivity()
		return
	}
	if time.Since(s.activityHid) < refocusGrace {
		return
	}
	s.activity = s.openActivity()
	if err := tray.PositionWindow(s.activity, trayGap); err != nil {
		log.Printf("tray: place the window at the icon: %v", err)
	}
	clearTaskbar(s.activity, trayGap)
	s.activity.Show().Focus()
}

// syncAll starts every job that can run, as if each had been started by hand,
// so no condition and no pause holds it.
func syncAll(ctx context.Context, runner *daemon.Runner) {
	for _, j := range startable(runner.Config().Jobs, runner.Running()) {
		go func() {
			if _, err := runner.Run(ctx, j.Key()); err != nil {
				log.Printf("tray: %s: %v", j.Name, err)
			}
		}()
	}
}

// startable is every job Force sync starts: switched on, both sides set, and
// not already running.
func startable(jobs []job.Job, running map[string]bool) []job.Job {
	var out []job.Job
	for _, j := range jobs {
		if j.Disabled || j.Left == "" || j.Right == "" || running[j.Name] {
			continue
		}
		out = append(out, j)
	}
	return out
}
