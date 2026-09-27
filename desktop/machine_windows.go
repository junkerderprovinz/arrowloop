package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"

	"github.com/junkerderprovinz/arrowloop/desktop/update"
	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// isInstalled reports whether this program is the copy the installer put in
// place for all users. A portable copy anywhere else updates itself.
func isInstalled() bool {
	loc := update.InstallLocation(product)
	if loc == "" {
		return false
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return strings.EqualFold(filepath.Dir(exe), filepath.Clean(loc))
}

// machineData returns the installation's folder under ProgramData.
func machineData() (string, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if err != nil {
		return "", err
	}
	return filepath.Join(base, product), nil
}

// updateInstalled is what the scheduled task runs as the system account, which
// may write to Program Files: one update of the installed copy, without a
// window, logged beside the switch it obeys.
func updateInstalled() error {
	dir, err := machineData()
	if err != nil {
		return err
	}
	logger := openUpdateLog(filepath.Join(dir, "update.log"))
	if !isInstalled() {
		logger.Printf("update: this is not the copy installed for all users, so --update leaves it alone")
		return errors.New("not the installed copy")
	}

	up := newUpdater(nil, logger, func(string) {})
	up.u.UninstallKey = product
	up.u.Cleanup()
	if !update.IsRelease(boot.Version) {
		logger.Printf("update: %s is not a release build, so it does not update itself", boot.Version)
		return nil
	}
	if !deskset.ReadAutoUpdate(filepath.Join(dir, machineSettingsFile)) {
		logger.Printf("update: Update automatically is off, so this run does nothing")
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
	defer cancel()
	up.once(ctx)
	return nil
}
