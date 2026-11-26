package appdata

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// Linux, as on the phone, allows names Windows refuses.
func TestTheWholeDiskListsAwkwardNames(t *testing.T) {
	client, dir, remote := serveWholeDisk(t)
	names := []string{"with space", "trailing ", "ünïcödé", "-dash", "dots...", "app.with.dots"}
	for _, n := range names {
		if err := os.Mkdir(filepath.Join(dir, n), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "file\twith tab"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	names = append(names, "file\twith tab")
	if err := os.Mkdir(filepath.Join(dir, "locked"), 0o000); err != nil {
		t.Fatal(err)
	}
	names = append(names, "locked")
	entries, err := client.ReadDir(remote)
	if err != nil {
		t.Fatal(err)
	}
	var listed []string
	for _, e := range entries {
		listed = append(listed, e.Name())
	}
	for _, n := range names {
		if !slices.Contains(listed, n) {
			t.Errorf("%q is missing from %q", n, listed)
		}
	}
}
