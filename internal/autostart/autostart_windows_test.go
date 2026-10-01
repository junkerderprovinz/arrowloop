package autostart

import "testing"

func TestTheRunValueIsQuoted(t *testing.T) {
	const exe = `C:\Users\Jane Doe\Desktop\ArrowLoop.exe`
	got := command(exe)

	if want := `"` + exe + `" --tray`; got != want {
		t.Fatalf("the Run value is %s, expected the quoted path and the tray flag: %s", got, want)
	}
}
