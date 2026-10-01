package deskset

import (
	"os"
	"path/filepath"
	"testing"
)

// Without a tray icon a hidden window could not be brought back.
func TestWithNowhereToSendItBothSettingsGoOff(t *testing.T) {
	dir := t.TempDir()
	s := Open(filepath.Join(dir, "arrowloop.json"))

	if err := s.Set(Settings{Tray: true, CloseToTray: true, MinimiseToTray: true}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if got := s.Get(); !got.CloseToTray || !got.MinimiseToTray {
		t.Fatalf("with an icon, both settings should stand: %+v", got)
	}

	if err := s.Set(Settings{Tray: false, CloseToTray: true, MinimiseToTray: true}); err != nil {
		t.Fatalf("set: %v", err)
	}
	got := s.Get()
	if got.CloseToTray || got.MinimiseToTray {
		t.Errorf("without an icon the window can be hidden with no way back: %+v", got)
	}
}

func TestTheDefaultCloseButtonCloses(t *testing.T) {
	if Default().CloseToTray {
		t.Error("a fresh install hides the window when told to close it")
	}
	if Default().MinimiseToTray {
		t.Error("a fresh install minimises somewhere other than the taskbar")
	}
	if !Default().Tray {
		t.Error("a background program with no icon anywhere is a program with no way back")
	}
}

func TestSettingsSurviveARestart(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "arrowloop.json")

	fresh := Open(config)
	if fresh.Get() != Default() {
		t.Fatalf("a missing file is not the default: %+v", fresh.Get())
	}
	if err := fresh.Set(Settings{Tray: true, MinimiseToTray: true}); err != nil {
		t.Fatalf("set: %v", err)
	}

	again := Open(config)
	if !again.Get().MinimiseToTray {
		t.Errorf("the choice did not survive: %+v", again.Get())
	}

	if err := os.WriteFile(filepath.Join(dir, "window.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if broken := Open(config); broken.Get() != Default() {
		t.Errorf("a corrupt file did not fall back to the default: %+v", broken.Get())
	}
}

func TestUpdatesAreOnUnlessTurnedOff(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "arrowloop.json")
	if !Open(config).Get().AutoUpdate {
		t.Error("a fresh install does not update itself")
	}

	// A window.json that does not name the switch.
	old := `{"tray": true, "closeToTray": true, "minimiseToTray": false, "notOnBattery": false, "notOnMetered": false, "paused": false}`
	if err := os.WriteFile(filepath.Join(dir, "window.json"), []byte(old), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	got := Open(config).Get()
	if !got.AutoUpdate {
		t.Error("an existing install does not update itself")
	}
	if !got.CloseToTray {
		t.Errorf("the file's own settings were lost: %+v", got)
	}

	if err := Open(config).Set(Settings{Tray: true, AutoUpdate: false}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if Open(config).Get().AutoUpdate {
		t.Error("turning updates off did not survive a restart")
	}
}

func TestTheUpdateSwitchCanLiveInAFileOfItsOwn(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "arrowloop.json")
	shared := filepath.Join(dir, "settings.json")

	s := Open(config)
	s.KeepAutoUpdateIn(shared)
	if !s.Get().AutoUpdate {
		t.Error("a missing shared file does not read as on")
	}
	if err := s.Set(Settings{Tray: true, AutoUpdate: false}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if ReadAutoUpdate(shared) {
		t.Error("turning updates off did not reach the shared file")
	}

	// The shared file wins over whatever window.json says.
	again := Open(config)
	if err := os.WriteFile(shared, []byte(`{"autoUpdate": true}`), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	again.KeepAutoUpdateIn(shared)
	if !again.Get().AutoUpdate {
		t.Error("the shared file's switch was not read")
	}
}

func TestASharedFileThatRefusesTheSwitchKeepsItsValue(t *testing.T) {
	dir := t.TempDir()
	s := Open(filepath.Join(dir, "arrowloop.json"))
	// A folder where the file should be cannot be written as a file.
	shared := filepath.Join(dir, "settings.json")
	if err := os.Mkdir(shared, 0o755); err != nil {
		t.Fatal(err)
	}
	s.KeepAutoUpdateIn(shared)

	if err := s.Set(Settings{Tray: true, AutoUpdate: false}); err == nil {
		t.Error("a refused write reported no error")
	}
	if !s.Get().AutoUpdate {
		t.Error("the page shows updates off although the file still says on")
	}
}

func TestAPauseSurvivesARestart(t *testing.T) {
	config := filepath.Join(t.TempDir(), "arrowloop.json")
	if err := Open(config).SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}
	if !Open(config).Get().Paused {
		t.Error("a paused app starts syncing again after a restart")
	}
}

// The page sends back everything it read, and a pause set from the tray after
// the page loaded would otherwise be undone by the next unrelated switch.
func TestTheSettingsPageCannotResumeAPause(t *testing.T) {
	s := Open(filepath.Join(t.TempDir(), "arrowloop.json"))
	if err := s.SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}
	if err := s.Set(Settings{Tray: true, MinimiseToTray: true, Paused: false}); err != nil {
		t.Fatalf("set: %v", err)
	}
	got := s.Get()
	if !got.Paused {
		t.Error("saving the settings page resumed a paused app")
	}
	if !got.MinimiseToTray {
		t.Errorf("the page's own change was lost: %+v", got)
	}

	if err := s.SetPaused(false); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if err := s.Set(Settings{Tray: true, Paused: true}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if s.Get().Paused {
		t.Error("saving the settings page paused the app")
	}
}

func TestTheTrayWordsSurviveARestart(t *testing.T) {
	config := filepath.Join(t.TempDir(), "arrowloop.json")
	if got := Open(config).Words(); got != DefaultWords() {
		t.Fatalf("a first start has no English words: %+v", got)
	}

	german := Words{Open: "Öffnen", SyncNow: "Sync erzwingen", Pause: "Sync pausieren",
		Resume: "Sync fortsetzen", Quit: "Beenden", Paused: "Sync ist pausiert",
		Running: "laufende Jobs: {count}", Done: "fertig"}
	if err := Open(config).SetWords(german); err != nil {
		t.Fatalf("set words: %v", err)
	}
	again := Open(config)
	if again.Words() != german {
		t.Errorf("the menu would start in English again: %+v", again.Words())
	}
	if again.Get() != Default() {
		t.Errorf("storing the words changed the settings: %+v", again.Get())
	}
}

func TestAWatcherHearsEveryChange(t *testing.T) {
	s := Open(filepath.Join(t.TempDir(), "arrowloop.json"))
	var seen []bool
	// Reading the store from inside the watcher is what the desktop shell does.
	s.Watch(func() { seen = append(seen, s.Get().Paused) })

	if err := s.Set(Settings{Tray: true}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if err := s.SetPaused(true); err != nil {
		t.Fatalf("pause: %v", err)
	}
	if err := s.SetWords(DefaultWords()); err != nil {
		t.Fatalf("words: %v", err)
	}
	if len(seen) != 3 {
		t.Fatalf("the watcher heard %d of 3 changes", len(seen))
	}
	if seen[0] || !seen[1] {
		t.Errorf("the watcher saw a stale pause: %v", seen)
	}
}

func TestTheTrayWindowKeepsItsSizeAcrossARestart(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "arrowloop.json")

	fresh := Open(config)
	if _, ok := fresh.ActivitySize(); ok {
		t.Fatal("a window nobody resized reports a size of its own")
	}
	if err := fresh.SetActivitySize(Size{Width: 420, Height: 640}); err != nil {
		t.Fatalf("set size: %v", err)
	}
	// A settings change rewrites the file and must not drop the size.
	if err := fresh.Set(Settings{Tray: true, CloseToTray: true}); err != nil {
		t.Fatalf("set: %v", err)
	}

	again := Open(config)
	got, ok := again.ActivitySize()
	if !ok || got != (Size{Width: 420, Height: 640}) {
		t.Errorf("the size came back as %+v, %v", got, ok)
	}
	if !again.Get().CloseToTray {
		t.Errorf("the size cost the settings: %+v", again.Get())
	}
}

// An update ends the program without asking it, so where the main window was
// has to be on disk before that.
func TestAWindowInTheTrayIsStillThereAfterARestart(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "arrowloop.json")

	fresh := Open(config)
	if fresh.InTray() {
		t.Fatal("a fresh install starts with its window in the tray")
	}
	if err := fresh.SetInTray(true); err != nil {
		t.Fatalf("to the tray: %v", err)
	}
	if err := fresh.Set(Settings{Tray: true, MinimiseToTray: true}); err != nil {
		t.Fatalf("set: %v", err)
	}
	if !Open(config).InTray() {
		t.Fatal("the window was in the tray, and the next start does not know")
	}

	if err := fresh.SetInTray(false); err != nil {
		t.Fatalf("back out: %v", err)
	}
	if Open(config).InTray() {
		t.Error("the window came back out, and the next start still hides it")
	}
}
