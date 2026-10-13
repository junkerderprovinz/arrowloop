package appdata

import (
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestNewFilesBelongToTheApp(t *testing.T) {
	if os.Getuid() != 0 {
		t.Skip("handing files to another owner needs root")
	}
	const appUID, extDataRW = 12345, 1078
	root := t.TempDir()
	app := filepath.Join(root, "com.example")
	if err := os.Mkdir(app, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(app, appUID, extDataRW); err != nil {
		t.Fatal(err)
	}
	seed := make([]byte, 32)
	_, _ = rand.Read(seed)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		_ = serve(ln, Options{Root: root, Password: testPassword, HostKey: seed, Adopt: true})
	}()
	client := connect(t, ln.Addr().String(), seed)

	if err := client.Mkdir("/com.example/saves"); err != nil {
		t.Fatal(err)
	}
	f, err := client.Create("/com.example/saves/slot1")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	for _, c := range []struct {
		path string
		mode os.FileMode
	}{
		{filepath.Join(app, "saves"), os.ModeDir | os.ModeSetgid | 0o770},
		{filepath.Join(app, "saves", "slot1"), 0o660},
	} {
		info, err := os.Lstat(c.path)
		if err != nil {
			t.Fatal(err)
		}
		st := info.Sys().(*syscall.Stat_t)
		if st.Uid != appUID || st.Gid != extDataRW {
			t.Errorf("%s belongs to %d:%d, want %d:%d", c.path, st.Uid, st.Gid, appUID, extDataRW)
		}
		if info.Mode() != c.mode {
			t.Errorf("%s has mode %v, want %v", c.path, info.Mode(), c.mode)
		}
	}
}
