package appdata

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
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
	return root, seed, ln.Addr().String()
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
