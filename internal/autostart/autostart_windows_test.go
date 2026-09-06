package autostart

import (
	"strings"
	"testing"
)

// The one failure this package exists to avoid, and the one that cannot be
// found on a developer machine whose paths have no spaces in them.
//
// Windows runs the Run value through command line splitting, so an unquoted
// path stops at its first space. jdp's own executable lives under
// "C:\Users\Junker der Provinz\Desktop\...", which has two: the entry would
// have tried to launch "C:\Users\Junker" at every sign-in and failed silently
// at a reboot, the worst possible place to find out.
func TestTheRunValueIsQuoted(t *testing.T) {
	const exe = `C:\Users\Junker der Provinz\Desktop\ArrowLoop.exe`
	got := command(exe)

	if !strings.HasPrefix(got, `"`) || !strings.HasSuffix(got, `"`) {
		t.Fatalf("the path is not quoted, so it breaks at its first space: %s", got)
	}
	if !strings.Contains(got, exe) {
		t.Fatalf("the quoted command lost the path: %s", got)
	}
}
