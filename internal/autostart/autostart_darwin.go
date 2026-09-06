package autostart

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const supported = true

var errUnsupported = errors.New("autostart is not supported on this system")

// label is the reverse-DNS name launchd wants, and it also names the file.
const label = "com.junkerderprovinz.arrowloop"

func entryPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", label+".plist"), nil
}

func enabled() (bool, error) {
	path, err := entryPath()
	if err != nil {
		return false, err
	}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read %s: %w", path, err)
	}
	return true, nil
}

func enable(exe string) error {
	path, err := entryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare %s: %w", filepath.Dir(path), err)
	}
	return os.WriteFile(path, []byte(plist(exe)), 0o644)
}

func disable() error {
	path, err := entryPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}

// plist is the LaunchAgent launchd reads at login.
//
// ProgramArguments rather than Program, because that form takes the path as one
// array element and needs no quoting at all: launchd never splits it, so a path
// with a space in it cannot break the way an unquoted command line does on the
// other two platforms.
//
// KeepAlive is deliberately absent. This starts the program once at login; a
// KeepAlive agent restarts it every time somebody quits it, which is not an
// autostart setting, it is a program that cannot be closed.
func plist(exe string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + label + `</string>
	<key>ProgramArguments</key>
	<array>
		<string>` + exe + `</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
`
}
