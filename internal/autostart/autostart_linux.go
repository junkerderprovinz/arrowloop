package autostart

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/flatpak"
)

const supported = true

var errUnsupported = errors.New("autostart is not supported on this system")

// entryPath is the file freedesktop session managers read on login, under
// XDG_CONFIG_HOME when the session sets it. Inside a Flatpak it is the file
// the Background portal writes under the app's ID. The sandbox points
// XDG_CONFIG_HOME into ~/.var/app, which the session never reads, so that path
// starts from the home directory.
func entryPath() (string, error) {
	if id := flatpak.ID(); id != "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".config", "autostart", id+".desktop"), nil
	}
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
	// Desktop settings dialogs switch an entry off by setting this key rather
	// than deleting the file.
	return !strings.Contains(string(body), "X-GNOME-Autostart-enabled=false"), nil
}

// pointsAt reports whether the existing entry already names this executable.
// The portal's entry starts the app through `flatpak run`, which always does.
func pointsAt(exe string) (bool, error) {
	if flatpak.ID() != "" {
		return true, nil
	}
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
			return after == execLine(exe), nil
		}
	}
	return false, nil
}

func enable(exe string) error {
	if flatpak.ID() != "" {
		granted, err := background(true, []string{filepath.Base(exe), arg})
		if err != nil {
			return err
		}
		if !granted {
			return errors.New("the desktop did not allow ArrowLoop to start when you sign in")
		}
		return nil
	}
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
	if flatpak.ID() != "" {
		_, err := background(false, nil)
		return err
	}
	path, err := entryPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}

// execLine is the desktop file's Exec value. The path is quoted because the
// desktop entry specification splits the field on spaces.
func execLine(exe string) string { return `"` + exe + `" ` + arg }

// entry is the desktop file.
func entry(exe string) string {
	return "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=" + Name + "\n" +
		"Comment=Two-way file synchronisation\n" +
		"Exec=" + execLine(exe) + "\n" +
		"Terminal=false\n" +
		"X-GNOME-Autostart-enabled=true\n"
}
