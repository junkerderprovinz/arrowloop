package deskset

import (
	"os"
	"path/filepath"
	"testing"
)

// TestWithNowhereToSendItBothSettingsGoOff.
//
// The two buttons can only hide the window if something is left to bring it
// back. Without an icon in the notification area, a close button that hides
// would leave a running program with no way in at all, and a person who had
// turned both on months ago would have no idea why their window never came
// back. So turning the icon off turns them off rather than keeping them as a
// promise the program cannot honour.
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

// TestTheDefaultCloseButtonCloses. A close button that quietly hides a running
// program is the kind of surprise somebody finds a week later, so it has to be
// asked for.
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

// TestSettingsSurviveARestart, and a file nobody has written yet is the default
// rather than an error.
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

	// A corrupt file is the default too. Losing a window preference is not a
	// reason to refuse to start.
	if err := os.WriteFile(filepath.Join(dir, "window.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if broken := Open(config); broken.Get() != Default() {
		t.Errorf("a corrupt file did not fall back to the default: %+v", broken.Get())
	}
}
