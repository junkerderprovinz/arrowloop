// Package deskset holds the settings that only exist when there is a window.
//
// They live in their own file, apart from the job configuration, so a container
// never carries them and the interface can tell from whether the endpoint
// answers whether to show them.
package deskset

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Settings is what a person can decide about the window itself.
type Settings struct {
	// Tray asks for an icon in the notification area. Without it the two
	// settings below have nowhere to send the window, so they are cleared too.
	Tray bool `json:"tray"`

	// CloseToTray sends the window to the notification area when the close
	// button is pressed, instead of ending the program. It is off by default
	// because a close button that does not close hides a running program.
	CloseToTray bool `json:"closeToTray"`

	// MinimiseToTray sends the window to the notification area instead of the
	// taskbar when it is minimised.
	MinimiseToTray bool `json:"minimiseToTray"`

	// NotOnBattery holds automatic runs while the machine is on battery. It is
	// a property of this machine rather than of the job, since the same
	// configuration can run on a laptop and a server. Manual runs are never
	// held.
	NotOnBattery bool `json:"notOnBattery"`

	// NotOnMetered does the same for a metered connection such as a phone
	// hotspot.
	NotOnMetered bool `json:"notOnMetered"`
}

// Default is what a fresh install gets: an icon in the notification area and
// both buttons doing what their labels say.
func Default() Settings { return Settings{Tray: true} }

// Store is the settings file. The window reads it on close while the interface
// writes it from another goroutine, hence the lock.
type Store struct {
	mu   sync.RWMutex
	path string
	now  Settings
}

// Open reads the settings beside the given configuration file. A missing,
// unreadable or corrupt file yields the defaults.
func Open(configPath string) *Store {
	s := &Store{
		path: filepath.Join(filepath.Dir(configPath), "window.json"),
		now:  Default(),
	}
	body, err := os.ReadFile(s.path)
	if err != nil {
		return s
	}
	var read Settings
	if err := json.Unmarshal(body, &read); err != nil {
		return s
	}
	s.now = read
	return s
}

// Get returns the current settings.
func (s *Store) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.now
}

// Set stores new settings and replaces the file in one step, so a crash leaves
// the old settings rather than half of the new ones.
func (s *Store) Set(next Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !next.Tray {
		next.CloseToTray = false
		next.MinimiseToTray = false
	}
	s.now = next

	body, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("prepare %s: %w", filepath.Dir(s.path), err)
	}
	tmp := s.path + ".writing"
	if err := os.WriteFile(tmp, append(body, '\n'), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("replace %s: %w", s.path, err)
	}
	return nil
}
