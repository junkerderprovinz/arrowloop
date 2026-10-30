//go:build updatetest

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/autostart"
)

func TestTheTestBuildKeepsItsOwnNames(t *testing.T) {
	base, err := os.UserConfigDir()
	if err != nil {
		t.Skipf("no configuration folder here: %v", err)
	}
	if autostart.Name != "ArrowLoop Test" {
		t.Errorf("autostart entry %q, want ArrowLoop Test", autostart.Name)
	}
	if !ownData {
		t.Error("the test build shares Wails' default window storage with a real installation")
	}
	path, err := configLocation("")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(base, "ArrowLoop Test", "arrowloop.json"); path != want {
		t.Errorf("configuration %q, want %q", path, want)
	}
	if got := instanceID("", path); got != "com.junkerderprovinz.arrowloop.test" {
		t.Errorf("single-instance lock %q", got)
	}
	if want := filepath.Join(base, "ArrowLoop Test", "rclone.conf"); rcloneConfig(path) != want {
		t.Errorf("rclone configuration %q, want %q", rcloneConfig(path), want)
	}
}
