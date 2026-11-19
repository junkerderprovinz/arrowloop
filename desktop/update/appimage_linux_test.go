package update

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The program in an AppImage runs from a read-only mount of the file, so the
// update has to replace the file the user started.
func TestAnAppImageReplacesTheFileItRunsFrom(t *testing.T) {
	platform := runtime.GOOS + "/" + runtime.GOARCH
	rel := fakeRelease{tag: "v1.4.0", files: map[string][]byte{
		AppImages[platform]: []byte("new AppImage"),
		Assets[platform]:    []byte("new program"),
	}}
	srv := serve(t, rel.withSums(keep))
	dir := t.TempDir()
	image := filepath.Join(dir, "ArrowLoop.AppImage")
	if err := os.WriteFile(image, []byte("old AppImage"), 0o755); err != nil {
		t.Fatal(err)
	}
	// The AppImage runtime keeps the file open while the program runs.
	running, err := os.Open(image)
	if err != nil {
		t.Fatal(err)
	}
	defer running.Close()

	u := &Updater{Repo: "owner/prog", Version: "v1.3.0", Assets: Assets, API: srv.URL, Client: srv.Client(), Logf: t.Logf}
	u.ForAppImage(image)
	found, err := u.Check(t.Context())
	if err != nil || found == nil {
		t.Fatalf("check: %+v, %v", found, err)
	}
	download, err := u.Fetch(t.Context(), found)
	if err != nil {
		t.Fatal(err)
	}
	if err := u.Swap(download, found); err != nil {
		t.Fatal(err)
	}

	if got := readFile(t, image); got != "new AppImage" {
		t.Errorf("the AppImage holds %q", got)
	}
	info, err := os.Stat(image)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Errorf("mode %v, want 0755", info.Mode().Perm())
	}
	buf := make([]byte, 12)
	if _, err := running.ReadAt(buf, 0); err != nil || string(buf) != "old AppImage" {
		t.Errorf("the running AppImage reads %q, %v", buf, err)
	}
	if got := dirEntries(t, dir); len(got) != 1 {
		t.Errorf("folder holds %v", got)
	}
}
