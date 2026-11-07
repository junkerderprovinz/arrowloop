package autostart

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheExecLineIsQuoted(t *testing.T) {
	const exe = "/home/jane doe/bin/ArrowLoop"
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
	if want := `"` + exe + `" --tray`; exec != want {
		t.Fatalf("the Exec line is %s, expected the quoted path and the tray flag: %s", exec, want)
	}
}

// A desktop environment switches an entry off by setting this key rather than
// deleting the file.
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

// inFlatpak makes the test run as the app would inside its sandbox, with a
// stand-in for the Background portal that records what it was asked.
func inFlatpak(t *testing.T, granted bool) (home string, asked *[]portalCall) {
	t.Helper()
	home = t.TempDir()
	t.Setenv("FLATPAK_ID", "io.github.junkerderprovinz.arrowloop")
	t.Setenv("HOME", home)
	// Where the sandbox points it, which the session never reads.
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".var", "app", "io.github.junkerderprovinz.arrowloop", "config"))
	calls := []portalCall{}
	was := background
	background = func(on bool, commandline []string) (bool, error) {
		calls = append(calls, portalCall{on, commandline})
		return granted && on, nil
	}
	t.Cleanup(func() { background = was })
	return home, &calls
}

type portalCall struct {
	on          bool
	commandline []string
}

func TestAFlatpakAsksThePortal(t *testing.T) {
	home, asked := inFlatpak(t, true)

	if err := Set(true); err != nil {
		t.Fatalf("switch on: %v", err)
	}
	if err := Set(false); err != nil {
		t.Fatalf("switch off: %v", err)
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	want := []portalCall{{true, []string{filepath.Base(exe), "--tray"}}, {false, nil}}
	if len(*asked) != len(want) {
		t.Fatalf("the portal was asked %d times, want %d: %+v", len(*asked), len(want), *asked)
	}
	for i, call := range *asked {
		if call.on != want[i].on || strings.Join(call.commandline, " ") != strings.Join(want[i].commandline, " ") {
			t.Errorf("call %d was %+v, want %+v", i, call, want[i])
		}
	}
	sandboxed := filepath.Join(home, ".var", "app", "io.github.junkerderprovinz.arrowloop", "config", "autostart")
	if _, err := os.Stat(sandboxed); !os.IsNotExist(err) {
		t.Errorf("an entry was written inside the sandbox, where the session never looks (%v)", err)
	}
}

func TestAFlatpakTheDesktopRefusesSaysSo(t *testing.T) {
	inFlatpak(t, false)
	if err := Set(true); err == nil {
		t.Fatal("the desktop said no and Set reported success")
	}
}

// The portal writes the entry into the session's autostart directory under the
// app's ID, and that file is what says whether the app starts.
func TestAFlatpakReadsThePortalsEntry(t *testing.T) {
	home, _ := inFlatpak(t, true)
	if on, err := Enabled(); err != nil || on {
		t.Fatalf("with no entry Enabled() = %v, %v", on, err)
	}

	dir := filepath.Join(home, ".config", "autostart")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := "[Desktop Entry]\nType=Application\nName=ArrowLoop\n" +
		"Exec=flatpak run --command=arrowloop io.github.junkerderprovinz.arrowloop --tray\n" +
		"X-Flatpak=io.github.junkerderprovinz.arrowloop\n"
	path := filepath.Join(dir, "io.github.junkerderprovinz.arrowloop.desktop")
	if err := os.WriteFile(path, []byte(entry), 0o644); err != nil {
		t.Fatal(err)
	}
	if on, err := Enabled(); err != nil || !on {
		t.Fatalf("with the portal's entry Enabled() = %v, %v", on, err)
	}
}

// The portal's entry starts the app through `flatpak run`, which no move of the
// executable can make stale.
func TestRefreshLeavesAFlatpakEntryAlone(t *testing.T) {
	home, asked := inFlatpak(t, true)
	dir := filepath.Join(home, ".config", "autostart")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "io.github.junkerderprovinz.arrowloop.desktop")
	if err := os.WriteFile(path, []byte("[Desktop Entry]\nExec=flatpak run io.github.junkerderprovinz.arrowloop --tray\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Refresh(); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if len(*asked) != 0 {
		t.Errorf("a refresh asked the portal again: %+v", *asked)
	}
}

func TestThePortalHearsTheWholeRequest(t *testing.T) {
	opts := backgroundOptions(true, []string{"arrowloop", "--tray"}, "arrowloop1")
	if v, ok := opts["autostart"].Value().(bool); !ok || !v {
		t.Errorf("autostart = %v", opts["autostart"])
	}
	if v, ok := opts["commandline"].Value().([]string); !ok || strings.Join(v, " ") != "arrowloop --tray" {
		t.Errorf("commandline = %v", opts["commandline"])
	}
	if v, ok := opts["handle_token"].Value().(string); !ok || v != "arrowloop1" {
		t.Errorf("handle_token = %v", opts["handle_token"])
	}

	off := backgroundOptions(false, nil, "arrowloop2")
	if v, ok := off["autostart"].Value().(bool); !ok || v {
		t.Errorf("switching off sends autostart = %v", off["autostart"])
	}
	if _, ok := off["commandline"]; ok {
		t.Error("switching off sends a command line the portal has no use for")
	}
}
