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
