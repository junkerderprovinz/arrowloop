package job

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOnePlaceIsFoundUnderAnotherSpelling(t *testing.T) {
	dir := t.TempDir()
	fotos := filepath.Join(dir, "fotos")
	if err := os.Mkdir(fotos, 0o755); err != nil {
		t.Fatal(err)
	}
	if !SamePlace(fotos, filepath.Join(dir, "x", "..", "fotos")) {
		t.Error("a detour through .. was taken for another place")
	}
	if SamePlace(fotos, filepath.Join(dir, "sicherung")) {
		t.Error("two different folders were taken for one")
	}
	if SamePlace("Garage:eimer", "Garage:eimer/") {
		t.Error("a target was compared as a folder on this machine")
	}
	// On a volume that does not tell case apart, as on Windows and most Macs,
	// FOTOS is the same folder, which only the file system can say.
	var err error
	if _, statErr := os.Stat(filepath.Join(dir, "FOTOS")); statErr == nil {
		err = loadWithSides(t, fotos, filepath.Join(dir, "FOTOS"))
		if err == nil || !strings.Contains(err.Error(), "snake eating its own tail") {
			t.Errorf("a job with its left side in other case on the right loaded: %v", err)
		}
	}

	link := filepath.Join(dir, "verknuepfung")
	if err := os.Symlink(fotos, link); err != nil {
		t.Skipf("this system will not make a symlink: %v", err)
	}
	if !SamePlace(fotos, link) {
		t.Error("a symlink to the folder was taken for another place")
	}
	err = loadWithSides(t, fotos, link)
	if err == nil || !strings.Contains(err.Error(), "snake eating its own tail") {
		t.Errorf("a job with a symlink to its own left side loaded: %v", err)
	}
}
