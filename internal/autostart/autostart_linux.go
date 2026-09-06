package autostart

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const supported = true

var errUnsupported = errors.New("autostart is not supported on this system")

// entryPath is the file every freedesktop session manager reads on login. It
// honours XDG_CONFIG_HOME because a session that sets it means it, and falling
// straight to ~/.config would write somewhere nothing looks.
func entryPath() (string, error) {
	dir := os.Getenv("XDG_CONFIG_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, ".config")
	}
	return filepath.Join(dir, "autostart", "arrowloop.desktop"), nil
}

func enabled() (bool, error) {
	path, err := entryPath()
	if err != nil {
		return false, err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read %s: %w", path, err)
	}
	// A file left behind with the GNOME key set to false is how the desktop's
	// own settings dialog switches an entry OFF without deleting it. Reading
	// the file's existence alone would report autostart as on for an entry the
	// session is deliberately ignoring.
	return !strings.Contains(string(body), "X-GNOME-Autostart-enabled=false"), nil
}

// pointsAt reports whether the existing entry already names this executable.
func pointsAt(exe string) (bool, error) {
	path, err := entryPath()
	if err != nil {
		return false, err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read %s: %w", path, err)
	}
	for line := range strings.SplitSeq(string(body), "\n") {
		if after, ok := strings.CutPrefix(strings.TrimRight(line, "\r"), "Exec="); ok {
			return after == `"`+exe+`"`, nil
		}
	}
	return false, nil
}

func enable(exe string) error {
	path, err := entryPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare %s: %w", filepath.Dir(path), err)
	}
	return os.WriteFile(path, []byte(entry(exe)), 0o644)
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

// entry is the desktop file itself.
//
// Exec is quoted for the same reason the Windows value is: the desktop entry
// specification splits the field on spaces, so an unquoted path breaks for
// anybody whose home directory has one in it.
func entry(exe string) string {
	return "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=" + name + "\n" +
		"Comment=Two-way file synchronisation\n" +
		"Exec=\"" + exe + "\"\n" +
		"Terminal=false\n" +
		"X-GNOME-Autostart-enabled=true\n"
}
