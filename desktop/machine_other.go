//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
)

// isInstalled reports false: only the Windows installer puts a copy in place
// for all users.
func isInstalled() bool { return false }

func machineData() (string, error) {
	return "", errors.New("only Windows has a folder for all users")
}

// installerChoices is the file the Linux installer keeps its choices in, the
// language among them. macOS has no installer, so nothing is ever there.
func installerChoices() (string, error) {
	data := os.Getenv("XDG_DATA_HOME")
	if !filepath.IsAbs(data) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		data = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(data, installID, "install.json"), nil
}

func updateInstalled() error {
	return errors.New("--update is what the Windows installer's scheduled task runs")
}
