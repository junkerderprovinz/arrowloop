//go:build !updatetest

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	if ownData {
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
	if got := rcloneConfig(path); got != "" {
		t.Errorf("rclone configuration %q, want rclone's own default", got)
	}
}

// D-Bus refuses a bus name whose element starts with a digit, and Wails takes
// the single-instance name as one on Linux.
func TestAnInstanceNameForAnyConfigurationIsAValidBusName(t *testing.T) {
	for i := range 64 {
		name := instanceID("x", filepath.Join("configs", strconv.Itoa(i), "arrowloop.json"))
		for _, part := range strings.Split(name, ".") {
			if part == "" || part[0] >= '0' && part[0] <= '9' {
				t.Fatalf("%q has the element %q", name, part)
			}
		}
	}
}
