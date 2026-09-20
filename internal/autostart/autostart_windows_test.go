package autostart

import (
	"strings"
	"testing"
)

func TestTheRunValueIsQuoted(t *testing.T) {
	const exe = `C:\Users\Jane Doe\Desktop\ArrowLoop.exe`
	got := command(exe)

	if !strings.HasPrefix(got, `"`) || !strings.HasSuffix(got, `"`) {
		t.Fatalf("the path is not quoted, so it breaks at its first space: %s", got)
	}
	if !strings.Contains(got, exe) {
		t.Fatalf("the quoted command lost the path: %s", got)
	}
}
