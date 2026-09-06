// Package deskset holds the settings that only exist when there is a window.
//
// They live apart from the job configuration on purpose. A container has no
// title bar and no notification area, so a setting about what the close button
// does would be a setting with nothing to act on, sitting in the same file that
// a server reads. Keeping them in their own file means the container never
// carries them and the interface can tell, from whether the endpoint answers at
// all, whether to draw the card.
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
	// settings below have nowhere to send the window, so turning it off turns
	// them off as well rather than leaving them pointing at nothing.
	Tray bool `json:"tray"`

	// CloseToTray sends the window to the notification area when somebody
	// presses the close button, instead of ending the program.
	//
	// Off by default. A close button that does not close is a surprise, and a
	// surprise that hides a running program is the kind somebody discovers a
	// week later when they wonder why a job keeps running.
	CloseToTray bool `json:"closeToTray"`

	// MinimiseToTray sends the window to the notification area instead of the
	// taskbar when somebody minimises it.
	MinimiseToTray bool `json:"minimiseToTray"`
}

// Default is what a fresh install gets: an icon in the notification area,
// because that is what a background program is expected to have, and both
// buttons doing exactly what their labels say.
func Default() Settings { return Settings{Tray: true} }

// Store is the settings file, read and written under a lock.
//
// A lock rather than a bare file, because the window's own code reads these on
// every close while the interface writes them from a browser tab, and those are
// different goroutines.
type Store struct {
	mu   sync.RWMutex
	path string
	now  Settings
}

// Open reads the settings beside the given configuration file, creating
// nothing: a missing file is the default, which is also what an unreadable or
// corrupt one becomes. Losing a window preference is not worth refusing to
// start over.
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

// Get is the current settings.
func (s *Store) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.now
}

// Set stores new settings and writes them out.
//
// The file is replaced in one step, so a crash midway leaves the old settings
// rather than half of the new ones.
func (s *Store) Set(next Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Nowhere to send the window means neither setting can do anything, so
	// they are cleared rather than kept as a promise the program cannot keep.
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
