package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/desktop/update"
	"github.com/junkerderprovinz/arrowloop/internal/appimage"
	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/flatpak"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// The first check waits for the window and the schedules to settle; one a day
// follows. An installed copy looks every followEvery for a version the
// scheduled task has put in place.
var (
	updateAPI   = "https://api.github.com"
	firstCheck  = time.Minute
	followEvery = 10 * time.Minute
)

const checkEvery = 24 * time.Hour

// updateReadyEvent carries the version that waits for the next start, so the
// window can say so.
const updateReadyEvent = "arrowloop:update-ready"

// updater keeps the desktop app current. It is the only caller of
// update.Updater in its process, so there is never more than one update in
// flight.
type updater struct {
	u        *update.Updater
	settings *deskset.Store
	log      *log.Logger
	// announce tells the windows which version waits for the next start.
	announce func(version string)
	// swapping is held while the program is being replaced, and by stop for
	// good, so the process never exits halfway through a swap.
	swapping sync.Mutex
	// installed is the copy the installer put in place for all users, which
	// only an elevated run can replace.
	installed bool
	// restart ends the program and starts it again; set by the shell.
	restart func()

	mu     sync.Mutex
	status web.UpdateStatus
}

func newUpdater(settings *deskset.Store, logger *log.Logger, announce func(version string)) *updater {
	u := &update.Updater{
		Repo:    update.Repo,
		Version: boot.Version,
		Assets:  update.Assets,
		API:     updateAPI,
		// Long enough for the program on a slow line, short enough that a
		// connection that stalls does not hold up every later check.
		Client: &http.Client{Timeout: 30 * time.Minute},
		Logf:   logger.Printf,
	}
	if image := appimage.Path(); image != "" {
		u.ForAppImage(image)
	}
	up := &updater{settings: settings, log: logger, announce: announce, u: u, status: web.UpdateStatus{Percent: -1}}
	u.Progress = up.progress
	return up
}

// openUpdateLog appends to the log at path, since a windowed program on
// Windows has no console to say why an update did not happen. A log grown past
// 256 KiB starts over.
func openUpdateLog(path string) *log.Logger {
	var w io.Writer = os.Stderr
	if os.MkdirAll(filepath.Dir(path), 0o755) == nil {
		flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
		if info, err := os.Stat(path); err == nil && info.Size() > 256<<10 {
			flags |= os.O_TRUNC
		}
		if f, err := os.OpenFile(path, flags, 0o644); err == nil {
			// The file comes first: MultiWriter stops at the first error, and
			// a windowed program's stderr may be no handle at all.
			w = io.MultiWriter(f, os.Stderr)
		}
	}
	return log.New(w, "", log.LstdFlags)
}

// run removes what the last update left and then checks for updates until ctx
// ends. A build that does not know which release it is never checks, and a
// Flatpak leaves updates to the software centre, which owns its files.
func (up *updater) run(ctx context.Context) {
	if flatpak.ID() != "" {
		up.log.Printf("update: the software centre keeps this Flatpak current")
		return
	}
	up.u.Cleanup()
	if !update.IsRelease(boot.Version) {
		up.log.Printf("update: %s is not a release build, so it does not update itself", boot.Version)
		return
	}
	timer := time.NewTimer(firstCheck)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if up.settings.Get().AutoUpdate {
			if err := up.once(ctx); err != nil {
				up.log.Printf("update: %v", err)
			}
		}
		timer.Reset(checkEvery)
	}
}

// follow is run for the installed copy, which cannot replace itself. It waits
// for the scheduled task to record a newer version in the uninstall entry and
// says once that it starts next time.
func (up *updater) follow(ctx context.Context) {
	tick := time.NewTicker(followEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		if v := update.InstalledVersion(product); update.Newer(v, boot.Version) {
			up.ready(v)
			return
		}
	}
}

// once updates to the newest release, if there is a newer one.
func (up *updater) once(ctx context.Context) error {
	rel, err := up.u.Check(ctx)
	if err != nil {
		return err
	}
	if rel == nil {
		up.log.Printf("update: no newer release")
		return nil
	}
	download, err := up.u.Fetch(ctx, rel)
	if err != nil {
		return fmt.Errorf("not updating to %s: %w", rel.Version, err)
	}
	defer os.Remove(download)

	up.swapping.Lock()
	err = up.u.Swap(download, rel)
	up.swapping.Unlock()
	if err != nil {
		return fmt.Errorf("not updating to %s: %w", rel.Version, err)
	}
	up.log.Printf("update: %s is in place and starts next time", rel.Version)
	up.ready(rel.Version)
	return nil
}

// ready records the version in place for the next start and tells the windows.
func (up *updater) ready(version string) {
	up.mu.Lock()
	up.status.Ready = version
	up.mu.Unlock()
	up.announce(version)
}

func (up *updater) progress(done, total int64) {
	percent := -1
	if total > 0 {
		percent = int(done * 100 / total)
	}
	up.mu.Lock()
	up.status.Percent = percent
	up.mu.Unlock()
}

func (up *updater) Status() web.UpdateStatus {
	up.mu.Lock()
	defer up.mu.Unlock()
	return up.status
}

// Start is "Update now". The installed copy cannot write to its own folder, so
// it asks for an elevated run of the scheduled task's update and waits for the
// new version to show up in the uninstall entry.
func (up *updater) Start() {
	up.mu.Lock()
	if up.status.Busy {
		up.mu.Unlock()
		return
	}
	up.status = web.UpdateStatus{Ready: up.status.Ready, Busy: true, Percent: -1}
	up.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		var err error
		if up.installed {
			err = up.elevated(ctx)
		} else {
			err = up.once(ctx)
		}
		if err != nil {
			up.log.Printf("update: %v", err)
		}
		up.mu.Lock()
		up.status.Busy = false
		if err != nil {
			up.status.Failed = err.Error()
		}
		up.mu.Unlock()
	}()
}

func (up *updater) elevated(ctx context.Context) error {
	if err := updateElevated(); err != nil {
		return err
	}
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
		if v := update.InstalledVersion(product); update.Newer(v, boot.Version) {
			up.ready(v)
			return nil
		}
	}
}

func (up *updater) Restart() { up.restart() }

// stop takes the swap lock and keeps it, so a swap under way finishes and none
// starts while the program exits.
func (up *updater) stop() {
	up.swapping.Lock()
}
