//go:build !updatetest

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/autostart"
)

func TestTheReleaseBuildKeepsTheRealNames(t *testing.T) {
	base, err := os.UserConfigDir()
	if err != nil {
		t.Skipf("no configuration folder here: %v", err)
	}
	if product != "ArrowLoop" || installID != "com.junkerderprovinz.arrowloop" {
		t.Errorf("product %q, installID %q", product, installID)
	}
	if autostart.Name != "ArrowLoop" {
		t.Errorf("autostart entry %q, want ArrowLoop", autostart.Name)
	}
	if ownWebview {
		t.Error("the release build moves the window's storage off Wails' default folder")
	}
	path, err := configLocation("")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(base, "ArrowLoop", "arrowloop.json"); path != want {
		t.Errorf("configuration %q, want %q", path, want)
	}
	if got := instanceID("", path); got != "com.junkerderprovinz.arrowloop" {
		t.Errorf("single-instance lock %q", got)
	}
}
