package appdata

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const testPassword = "correct horse"

// start serves a fresh Android/data with one app folder and returns its root.
func start(t *testing.T, readOnly bool) (string, []byte, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "com.example", "files"), 0o770); err != nil {
		t.Fatal(err)
	}
	seed, addr := serveAt(t, root, readOnly)
	return root, seed, addr
}

func serveAt(t *testing.T, root string, readOnly bool) ([]byte, string) {
	t.Helper()
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		_ = serve(ln, Options{Root: root, Password: testPassword, HostKey: seed, ReadOnly: readOnly})
	}()
	return seed, ln.Addr().String()
}

// wholeDisk serves the root of the disk the test's temporary folder is on,
// read only, and returns that folder on disk and as a client names it.
func wholeDisk(t *testing.T) (dir, remote string, seed []byte, addr string) {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	volume := filepath.VolumeName(dir)
	seed, addr = serveAt(t, volume+string(filepath.Separator), true)
	return dir, filepath.ToSlash(strings.TrimPrefix(dir, volume)), seed, addr
}

func serveWholeDisk(t *testing.T) (*sftp.Client, string, string) {
	t.Helper()
	dir, remote, seed, addr := wholeDisk(t)
	return connect(t, addr, seed), dir, remote
}

func dial(t *testing.T, addr string, seed []byte, password string) (*sftp.Client, error) {
	t.Helper()
	pub, err := PublicKey(seed)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            User,
		Auth:            []ssh.AuthMethod{ssh.Password(password)},
		HostKeyCallback: ssh.FixedHostKey(pub),
		Timeout:         5 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() { conn.Close() })
	client, err := sftp.NewClient(conn)
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() { client.Close() })
	return client, nil
}

func connect(t *testing.T, addr string, seed []byte) *sftp.Client {
	t.Helper()
	client, err := dial(t, addr, seed, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestWrongPasswordIsRefused(t *testing.T) {
	_, seed, addr := start(t, false)
	if _, err := dial(t, addr, seed, "guess"); err == nil {
		t.Fatal("a wrong password got in")
	}
}

func TestListsTheAppFolders(t *testing.T) {
	_, seed, addr := start(t, false)
	entries, err := connect(t, addr, seed).ReadDir("/")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "com.example" || !entries[0].IsDir() {
		t.Fatalf("root lists %v", entries)
	}
}

func TestWritesAFileWithItsModificationTime(t *testing.T) {
	root, seed, addr := start(t, false)
	client := connect(t, addr, seed)

	f, err := client.Create("/com.example/files/save.dat")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("level 3")); err != nil {
		t.Fatal(err)
	}
	f.Close()
	when := time.Date(2024, 5, 6, 7, 8, 9, 0, time.UTC)
	if err := client.Chtimes("/com.example/files/save.dat", when, when); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(root, "com.example", "files", "save.dat"))
	if err != nil || string(data) != "level 3" {
		t.Fatalf("on disk: %q, %v", data, err)
	}
	info, err := client.Stat("/com.example/files/save.dat")
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(when) {
		t.Fatalf("modification time %v, want %v", info.ModTime(), when)
	}
}

func TestOnlyAndroidCreatesAppFolders(t *testing.T) {
	_, seed, addr := start(t, false)
	client := connect(t, addr, seed)
	if err := client.Mkdir("/com.other"); err == nil {
		t.Fatal("made a folder next to the app folders")
	}
	if _, err := client.Create("/loose.txt"); err == nil {
		t.Fatal("made a file next to the app folders")
	}
}

func TestReadOnlyRefusesChangesButReads(t *testing.T) {
	root, seed, addr := start(t, true)
	if err := os.WriteFile(filepath.Join(root, "com.example", "files", "keep.txt"), []byte("kept"), 0o660); err != nil {
		t.Fatal(err)
	}
	client := connect(t, addr, seed)

	if _, err := client.Create("/com.example/files/new.txt"); err == nil {
		t.Fatal("created a file on a read-only server")
	}
	if err := client.Remove("/com.example/files/keep.txt"); err == nil {
		t.Fatal("removed a file on a read-only server")
	}
	if err := client.Mkdir("/com.example/files/sub"); err == nil {
		t.Fatal("made a folder on a read-only server")
	}
	f, err := client.Open("/com.example/files/keep.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	data, _ := io.ReadAll(f)
	if string(data) != "kept" {
		t.Fatalf("read %q", data)
	}
}

func TestDoesNotFollowLinksOutOfTheRoot(t *testing.T) {
	root, seed, addr := start(t, false)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "com.example", "files", "door")); err != nil {
		t.Skipf("cannot make a link here: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(root, "com.example", "files", "note")); err != nil {
		t.Skipf("cannot make a link here: %v", err)
	}
	client := connect(t, addr, seed)

	if f, err := client.Open("/com.example/files/door/secret"); err == nil {
		data, _ := io.ReadAll(f)
		f.Close()
		t.Fatalf("read %q through a linked folder", data)
	}
	if f, err := client.Open("/com.example/files/note"); err == nil {
		data, _ := io.ReadAll(f)
		f.Close()
		if bytes.Contains(data, []byte("private")) {
			t.Fatal("read the target of a linked file")
		}
	}
	if f, err := client.Create("/com.example/files/door/planted"); err == nil {
		f.Close()
		t.Fatal("wrote through a linked folder")
	}
	if _, err := os.Stat(filepath.Join(outside, "planted")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a file appeared outside the root")
	}
}

func TestDotDotStaysInside(t *testing.T) {
	_, seed, addr := start(t, false)
	entries, err := connect(t, addr, seed).ReadDir("/../../..")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "com.example" {
		t.Fatalf("/../../.. lists %v", entries)
	}
}

func TestMovingBetweenAppsIsRefused(t *testing.T) {
	root, seed, addr := start(t, false)
	if err := os.MkdirAll(filepath.Join(root, "com.other"), 0o770); err != nil {
		t.Fatal(err)
	}
	client := connect(t, addr, seed)
	f, err := client.Create("/com.example/files/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := client.Rename("/com.example/files/a.txt", "/com.other/a.txt"); err == nil {
		t.Fatal("moved a file into another app's folder")
	}
	if err := client.Rename("/com.example/files/a.txt", "/com.example/files/b.txt"); err != nil {
		t.Fatalf("rename within the app: %v", err)
	}
}

func TestServesTheWholeDiskFromItsRoot(t *testing.T) {
	client, dir, remote := serveWholeDisk(t)
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("deep down"), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := client.Open(remote + "/notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	data, _ := io.ReadAll(f)
	if string(data) != "deep down" {
		t.Fatalf("read %q", data)
	}
	entries, err := client.ReadDir(remote)
	if err != nil || len(entries) != 1 {
		t.Fatalf("%s lists %v, %v", remote, entries, err)
	}
}

func TestTheWholeDiskRefusesEveryChange(t *testing.T) {
	client, dir, remote := serveWholeDisk(t)
	if err := os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("kept"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "box"), 0o700); err != nil {
		t.Fatal(err)
	}
	keep := remote + "/keep.txt"
	changes := map[string]func() error{
		"create": func() error {
			f, err := client.Create(remote + "/new.txt")
			if err == nil {
				f.Close()
			}
			return err
		},
		"open for writing": func() error {
			f, err := client.OpenFile(keep, os.O_RDWR)
			if err == nil {
				f.Close()
			}
			return err
		},
		"remove":   func() error { return client.Remove(keep) },
		"rename":   func() error { return client.Rename(keep, remote+"/moved.txt") },
		"mkdir":    func() error { return client.Mkdir(remote + "/sub") },
		"rmdir":    func() error { return client.RemoveDirectory(remote + "/box") },
		"truncate": func() error { return client.Truncate(keep, 0) },
		"chtimes":  func() error { return client.Chtimes(keep, time.Unix(0, 0), time.Unix(0, 0)) },
		"chmod":    func() error { return client.Chmod(keep, 0o777) },
		"symlink":  func() error { return client.Symlink(keep, remote+"/pointer") },
		"link":     func() error { return client.Link(keep, remote+"/twin") },
	}
	for name, change := range changes {
		if err := change(); err == nil {
			t.Errorf("%s went through", name)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, "keep.txt"))
	if err != nil || string(data) != "kept" {
		t.Fatalf("keep.txt now holds %q, %v", data, err)
	}
	names, _ := os.ReadDir(dir)
	if len(names) != 2 {
		t.Fatalf("the folder now holds %v", names)
	}
}

func TestListingsLeaveLinksOut(t *testing.T) {
	root, seed, addr := start(t, false)
	files := filepath.Join(root, "com.example", "files")
	if err := os.WriteFile(filepath.Join(files, "real.txt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(files, filepath.Join(files, "loop")); err != nil {
		t.Skipf("cannot make a link here: %v", err)
	}
	client := connect(t, addr, seed)
	entries, err := client.ReadDir("/com.example/files")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "real.txt" {
		t.Fatalf("the folder lists %v", entries)
	}
	if listed, err := client.ReadDir("/com.example/files/loop"); err == nil {
		t.Fatalf("listed through a link: %v", listed)
	}
}
