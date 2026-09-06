package autostart

import (
	"errors"
	"fmt"

	"golang.org/x/sys/windows/registry"
)

const supported = true

var errUnsupported = errors.New("autostart is not supported on this system")

// runKey is where Windows itself looks on sign-in. HKCU rather than HKLM: this
// runs as one person, and HKLM would need administrative rights to write.
const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

func enabled() (bool, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		// The key is created by Windows on every profile, but a missing one is
		// simply "nothing is registered here" rather than a fault worth
		// refusing to answer over.
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

// command is the string Windows executes on sign-in.
//
// The quotes are the whole reason this is a function with a test rather than a
// line inside enable. Windows runs this value through the same splitting a
// command line gets, so an unquoted path stops at its first space: the very
// first person to hit it is anybody whose user folder has a space in it, which
// is most people with a full name in their profile path. It fails silently at a
// reboot, which is the worst place to find out.
func command(exe string) string { return `"` + exe + `"` }
