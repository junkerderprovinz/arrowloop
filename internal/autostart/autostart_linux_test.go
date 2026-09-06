package autostart

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The desktop entry specification splits the Exec field on spaces exactly the
// way a command line is split, so an unquoted path breaks for anybody whose
// home directory has a space in it. Same failure as the Windows Run value, same
// silent shape: nothing happens at the next login and nothing says why.
func TestTheExecLineIsQuoted(t *testing.T) {
	const exe = "/home/junker der provinz/bin/ArrowLoop"
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)

	if err := enable(exe); err != nil {
		t.Fatalf("write the entry: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "autostart", "arrowloop.desktop"))
	if err != nil {
		t.Fatalf("read the entry: %v", err)
	}

	var exec string
	for line := range strings.SplitSeq(string(body), "\n") {
		if after, ok := strings.CutPrefix(line, "Exec="); ok {
			exec = after
		}
	}
	if exec == "" {
		t.Fatalf("the entry has no Exec line:\n%s", body)
	}
	if !strings.HasPrefix(exec, `"`) || !strings.HasSuffix(exec, `"`) {
		t.Fatalf("the path is not quoted, so it breaks at its first space: %s", exec)
	}
	if !strings.Contains(exec, exe) {
		t.Fatalf("the quoted Exec lost the path: %s", exec)
	}
}

// A desktop environment switches an entry off by setting this key rather than
// deleting the file. Reading the file's existence alone would report autostart
// as on for an entry the session is deliberately ignoring, and the toggle would
// show the opposite of what the machine does.
func TestADisabledEntryReadsAsOff(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)

	if err := enable("/usr/local/bin/ArrowLoop"); err != nil {
		t.Fatalf("write the entry: %v", err)
	}
	path := filepath.Join(dir, "autostart", "arrowloop.desktop")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the entry: %v", err)
	}
	turned := strings.Replace(string(body),
		"X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-enabled=false", 1)
	if turned == string(body) {
		t.Fatal("the entry carries no X-GNOME-Autostart-enabled key to turn off")
	}
	if err := os.WriteFile(path, []byte(turned), 0o644); err != nil {
		t.Fatalf("write the turned-off entry: %v", err)
	}

	on, err := enabled()
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if on {
		t.Fatal("an entry the session ignores is reported as on")
	}
}
