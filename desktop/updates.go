package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/desktop/update"
	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// The first check waits for the window and the schedules to settle; one a day
// follows.
var (
	updateAPI  = "https://api.github.com"
	firstCheck = time.Minute
)

const checkEvery = 24 * time.Hour

// updateReadyEvent carries the version that waits for the next start, so the
// window can say so.
const updateReadyEvent = "arrowloop:update-ready"

// updater keeps the desktop app current. It is the only caller of
// update.Updater, so there is never more than one update in flight.
type updater struct {
	u        *update.Updater
	settings *deskset.Store
	log      *log.Logger
	// announce tells the windows which version waits for the next start.
	announce func(version string)
	// swapping is held while the program is being replaced, and by stop for
	// good, so the process never exits halfway through a swap.
	swapping sync.Mutex
}

func newUpdater(settings *deskset.Store, logger *log.Logger, announce func(version string)) *updater {
	return &updater{
		settings: settings,
		log:      logger,
		announce: announce,
		u: &update.Updater{
			Repo:    update.Repo,
			Version: boot.Version,
			Assets:  update.Assets,
			// UNINST_KEY_NAME in build/windows/nsis/project.nsi.
			UninstallKey: "ArrowLoop",
			API:          updateAPI,
			// Long enough for the program on a slow line, short enough that a
			// connection that stalls does not hold up every later check.
			Client: &http.Client{Timeout: 30 * time.Minute},
			Logf:   logger.Printf,
		},
	}
}

// openUpdateLog writes to update.log beside the configuration, since a
// windowed program on Windows has no console to say why an update did not
// happen. A log grown past 256 KiB starts over.
func openUpdateLog(configPath string) *log.Logger {
	var w io.Writer = os.Stderr
	dir := filepath.Dir(configPath)
	if os.MkdirAll(dir, 0o755) == nil {
		path := filepath.Join(dir, "update.log")
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
// ends. A build that does not know which release it is never checks.
func (up *updater) run(ctx context.Context) {
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
			up.once(ctx)
		}
		timer.Reset(checkEvery)
	}
}

func (up *updater) once(ctx context.Context) {
	rel, err := up.u.Check(ctx)
	if err != nil {
		up.log.Printf("update: %v", err)
		return
	}
	if rel == nil {
		up.log.Printf("update: no newer release")
		return
	}
	download, err := up.u.Fetch(ctx, rel)
	if err != nil {
		up.log.Printf("update: not updating to %s: %v", rel.Version, err)
		return
	}
	defer os.Remove(download)

	up.swapping.Lock()
	err = up.u.Swap(download, rel)
	up.swapping.Unlock()
	if err != nil {
		up.log.Printf("update: not updating to %s: %v", rel.Version, err)
		return
	}
	up.log.Printf("update: %s is in place and starts next time", rel.Version)
	up.announce(rel.Version)
}

// stop takes the swap lock and keeps it, so a swap under way finishes and none
// starts while the program exits.
func (up *updater) stop() {
	up.swapping.Lock()
}
