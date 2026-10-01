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

	// Paused holds every automatic run until the person resumes. Only the tray
	// changes it, so saving an unrelated switch on the settings page cannot
	// resume syncing behind somebody's back.
	Paused bool `json:"paused"`

	// AutoUpdate lets the desktop app download a newer release in the
	// background and start it next time. A file that does not name it reads
	// as on, like a fresh install.
	AutoUpdate bool `json:"autoUpdate"`
}

// Words are the tray's few lines in the language the interface shows. The
// translations live in the interface, which sends them here, and they are kept
// so the menu is right on the next start before the interface has loaded.
type Words struct {
	Open    string `json:"open"`
	SyncNow string `json:"syncNow"`
	Pause   string `json:"pause"`
	Resume  string `json:"resume"`
	Quit    string `json:"quit"`
	Paused  string `json:"paused"`
	// Running carries a {count} placeholder.
	Running string `json:"running"`
	Done    string `json:"done"`
}

// DefaultWords is English, for a first start before the interface has said
// which language it shows.
func DefaultWords() Words {
	return Words{
		Open:    "Open",
		SyncNow: "Force sync",
		Pause:   "Pause sync",
		Resume:  "Resume sync",
		Quit:    "Quit",
		Paused:  "Sync is paused",
		Running: "jobs running: {count}",
		Done:    "done",
	}
}

// Default is what a fresh install gets: an icon in the notification area, both
// buttons doing what their labels say, and updates.
func Default() Settings { return Settings{Tray: true, AutoUpdate: true} }

// Size is a window's width and height.
type Size struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// file is window.json. The settings stay at the top level, where every
// earlier version wrote them.
type file struct {
	Settings
	Words *Words `json:"words,omitempty"`
	// Activity is the size the small window at the tray icon was left at.
	Activity *Size `json:"activity,omitempty"`
	// InTray says the main window was in the notification area.
	InTray bool `json:"inTray,omitempty"`
}

// Store is the settings file. The window reads it on close while the interface
// writes it from another goroutine, hence the lock.
type Store struct {
	mu       sync.RWMutex
	path     string
	now      Settings
	words    Words
	activity *Size
	inTray   bool
	watches  []func()
	// autoUpdatePath is the file set by KeepAutoUpdateIn, or "".
	autoUpdatePath string
}

// Open reads the settings beside the given configuration file. A missing,
// unreadable or corrupt file yields the defaults.
func Open(configPath string) *Store {
	s := &Store{
		path:  filepath.Join(filepath.Dir(configPath), "window.json"),
		now:   Default(),
		words: DefaultWords(),
	}
	body, err := os.ReadFile(s.path)
	if err != nil {
		return s
	}
	// Decoded over the defaults, so a setting added after the file was written
	// keeps its default. Every version wrote the three window switches.
	read := file{Settings: Default()}
	if err := json.Unmarshal(body, &read); err != nil {
		return s
	}
	s.now = read.Settings
	if read.Words != nil {
		s.words = *read.Words
	}
	s.activity = read.Activity
	s.inTray = read.InTray
	return s
}

// KeepAutoUpdateIn reads and writes the AutoUpdate switch in its own file at
// path. An installed copy on Windows is updated by a task that runs as the
// system rather than as any user, and reads the switch from there.
func (s *Store) KeepAutoUpdateIn(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.autoUpdatePath = path
	s.now.AutoUpdate = ReadAutoUpdate(path)
}

// autoUpdateFile is the file KeepAutoUpdateIn names.
type autoUpdateFile struct {
	AutoUpdate bool `json:"autoUpdate"`
}

// ReadAutoUpdate reads the switch from a file KeepAutoUpdateIn named. A
// missing, unreadable or corrupt file reads as on, like a fresh install.
func ReadAutoUpdate(path string) bool {
	body, err := os.ReadFile(path)
	if err != nil {
		return true
	}
	f := autoUpdateFile{AutoUpdate: true}
	if json.Unmarshal(body, &f) != nil {
		return true
	}
	return f.AutoUpdate
}

// writeAutoUpdate rewrites the file in place. Its folder belongs to the
// administrators and only the file itself is open to every user, so there is
// no folder to put a temporary file in.
func writeAutoUpdate(path string, on bool) error {
	body, err := json.Marshal(autoUpdateFile{AutoUpdate: on})
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, append(body, '\n'), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

// Get returns the current settings.
func (s *Store) Get() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.now
}

// Words returns the tray's lines.
func (s *Store) Words() Words {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.words
}

// ActivitySize returns the size the small window at the tray icon was left
// at, and false while nobody has resized it.
func (s *Store) ActivitySize() (Size, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.activity == nil {
		return Size{}, false
	}
	return *s.activity, true
}

// SetActivitySize keeps the small window's size for the next start. No
// setting depends on it, so the watchers are not told.
func (s *Store) SetActivitySize(size Size) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activity = &size
	return s.write()
}

// InTray reports whether the main window was in the notification area when
// the program last said where it was.
func (s *Store) InTray() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.inTray
}

// SetInTray records where the main window is. A program ended from outside
// cannot say so on its way out, so every move is written. No setting depends
// on it, so the watchers are not told.
func (s *Store) SetInTray(on bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inTray == on {
		return nil
	}
	s.inTray = on
	return s.write()
}

// Watch registers a function called after every change, from the goroutine
// that made it. The desktop shell uses it to follow the settings page without
// a restart.
func (s *Store) Watch(f func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.watches = append(s.watches, f)
}

// Set stores what the settings page decides. The pause belongs to the tray and
// is carried over, whatever the page sent.
func (s *Store) Set(next Settings) error {
	return s.change(func() {
		if !next.Tray {
			next.CloseToTray = false
			next.MinimiseToTray = false
		}
		next.Paused = s.now.Paused
		s.now = next
	})
}

// SetPaused holds or releases every automatic run.
func (s *Store) SetPaused(on bool) error {
	return s.change(func() { s.now.Paused = on })
}

// SetWords stores the tray's lines in the interface's language.
func (s *Store) SetWords(w Words) error {
	return s.change(func() { s.words = w })
}

// change applies one edit under the lock, writes the file, and tells the
// watchers once the lock is released, so a watcher may read the store.
func (s *Store) change(edit func()) error {
	s.mu.Lock()
	wasAuto := s.now.AutoUpdate
	edit()
	var err error
	if s.autoUpdatePath != "" && s.now.AutoUpdate != wasAuto {
		// When the file refuses the change, the page goes on showing the
		// switch as the updates see it.
		if err = writeAutoUpdate(s.autoUpdatePath, s.now.AutoUpdate); err != nil {
			s.now.AutoUpdate = wasAuto
		}
	}
	if werr := s.write(); err == nil {
		err = werr
	}
	watches := append([]func(){}, s.watches...)
	s.mu.Unlock()

	for _, f := range watches {
		f()
	}
	return err
}

// write replaces the file in one step, so a crash leaves the old settings
// rather than half of the new ones. The caller holds the lock.
func (s *Store) write() error {
	words := s.words
	body, err := json.MarshalIndent(file{Settings: s.now, Words: &words, Activity: s.activity, InTray: s.inTray}, "", "  ")
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
