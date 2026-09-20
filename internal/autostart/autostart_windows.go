package autostart

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const supported = true

var errUnsupported = errors.New("autostart is not supported on this system")

// runKey is read by Windows on sign-in. It lives under HKCU, which needs no
// administrative rights to write.
const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

func enabled() (bool, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("open %s: %w", runKey, err)
	}
	defer k.Close()

	if _, _, err := k.GetStringValue(name); err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read %s: %w", name, err)
	}
	return true, nil
}

// pointsAt reports whether the registered value already names this executable.
func pointsAt(exe string) (bool, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("open %s: %w", runKey, err)
	}
	defer k.Close()

	got, _, err := k.GetStringValue(name)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read %s: %w", name, err)
	}
	// Windows paths are case-insensitive; a lower-case drive letter would
	// otherwise rewrite the value on every sign-in.
	return strings.EqualFold(got, command(exe)), nil
}

func enable(exe string) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open %s: %w", runKey, err)
	}
	defer k.Close()
	return k.SetStringValue(name, command(exe))
}

func disable() error {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("open %s: %w", runKey, err)
	}
	defer k.Close()
	if err := k.DeleteValue(name); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", name, err)
	}
	return nil
}

// command is the string Windows executes on sign-in. Windows splits the value
// like a command line, so the path is quoted for profile folders with spaces.
func command(exe string) string { return `"` + exe + `"` }
