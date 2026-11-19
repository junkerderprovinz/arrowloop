package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestOnlyACommandFirstSkipsTheWindow(t *testing.T) {
	for _, args := range [][]string{
		{"jobs"},
		{"run", "Fotos"},
		{"run-due"},
		{"history", "-job", "Fotos"},
		{"version"},
	} {
		if !isCommand(args) {
			t.Errorf("%q opens the window", args)
		}
	}
	for _, args := range [][]string{
		nil,
		{"--tray"},
		{"-tray"},
		{"-config", "other.json"},
		{"-config", "other.json", "jobs"},
		{"-update"},
		{"Fotos"},
	} {
		if isCommand(args) {
			t.Errorf("%q is taken for a command", args)
		}
	}
}

func TestACommandReadsTheAppsOwnConfiguration(t *testing.T) {
	home := t.TempDir()
	t.Setenv("APPDATA", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("HOME", home)
	dir := home
	if runtime.GOOS == "darwin" {
		dir = filepath.Join(home, "Library", "Application Support")
	}
	path := filepath.Join(dir, product, "arrowloop.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"jobs":[{"name":"Fotos","left":"/a","right":"/b","state":"fotos.db"}]}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	var out, errs bytes.Buffer
	if code := command([]string{"jobs"}, &out, &errs); code != 0 {
		t.Fatalf("exit %d: %s", code, &errs)
	}
	if !strings.Contains(out.String(), "Fotos") {
		t.Errorf("jobs printed %q, want the job from %s", &out, path)
	}
}
