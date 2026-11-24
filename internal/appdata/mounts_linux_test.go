package appdata

import (
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestAPipeIsNeitherListedNorOpened(t *testing.T) {
	root, seed, addr := start(t, true)
	files := filepath.Join(root, "com.example", "files")
	if err := syscall.Mkfifo(filepath.Join(files, "pipe"), 0o600); err != nil {
		t.Fatal(err)
	}
	client := connect(t, addr, seed)
	entries, err := client.ReadDir("/com.example/files")
	if err != nil || len(entries) != 0 {
		t.Fatalf("the folder lists %v, %v", entries, err)
	}
	opened := make(chan error, 1)
	go func() {
		f, err := client.Open("/com.example/files/pipe")
		if err == nil {
			_, err = f.Read(make([]byte, 1))
			f.Close()
		}
		opened <- err
	}()
	select {
	case err := <-opened:
		if err == nil {
			t.Fatal("read from a pipe")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("opening a pipe hung")
	}
}

func TestTheKernelsOwnFileSystemsAreLeftOut(t *testing.T) {
	seed, addr := serveAt(t, "/", true)
	client := connect(t, addr, seed)
	entries, err := client.ReadDir("/")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() == "proc" || e.Name() == "sys" {
			t.Errorf("/ lists %s", e.Name())
		}
	}
	for _, p := range []string{"/proc", "/proc/self", "/sys/kernel"} {
		if listed, err := client.ReadDir(p); err == nil {
			t.Errorf("%s lists %d entries", p, len(listed))
		}
	}
	if f, err := client.Open("/proc/version"); err == nil {
		f.Close()
		t.Error("opened /proc/version")
	}
}
