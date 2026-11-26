package appdata

import (
	"slices"
	"testing"
)

func TestMovesIntoInitsNamespaceFromAnApps(t *testing.T) {
	args := []string{"serve-data", "-root", "/", "-read-only"}
	got := intoInit("mnt:[4026533126]", "mnt:[4026532359]", "/system/bin/nsenter", "/data/app/al/lib/libarrowloop.so", args)
	want := []string{"/system/bin/nsenter", "-t", "1", "-m", "--", "/data/app/al/lib/libarrowloop.so", "serve-data", "-root", "/", "-read-only"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestStaysWhereItIsWhenItCannotOrNeedNotMove(t *testing.T) {
	cases := map[string][4]string{
		"already in init's":       {"mnt:[1]", "mnt:[1]", "/system/bin/nsenter", "/x"},
		"init's cannot be read":   {"mnt:[2]", "", "/system/bin/nsenter", "/x"},
		"its own cannot be read":  {"", "mnt:[1]", "/system/bin/nsenter", "/x"},
		"no nsenter on the phone": {"mnt:[2]", "mnt:[1]", "", "/x"},
		"no path to itself":       {"mnt:[2]", "mnt:[1]", "/system/bin/nsenter", ""},
	}
	for name, c := range cases {
		if got := intoInit(c[0], c[1], c[2], c[3], []string{"serve-data"}); got != nil {
			t.Errorf("%s: got %q", name, got)
		}
	}
}
