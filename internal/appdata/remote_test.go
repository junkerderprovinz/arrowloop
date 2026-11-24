package appdata

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/sftp"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
	"github.com/rclone/rclone/fs/sync"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "arrowloop-appdata-test")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	conf := filepath.Join(dir, "rclone.conf")
	if err := os.WriteFile(conf, nil, 0o600); err == nil {
		err = config.SetConfigPath(conf)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	configfile.Install()
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func remoteNamed(name string) *remotes.Remote {
	for _, r := range remotes.List() {
		if r.Name == name {
			return &r
		}
	}
	return nil
}

func TestLinkOffersTheTargetAndUnlinkTakesItAway(t *testing.T) {
	seed := make([]byte, 32)
	_, _ = rand.Read(seed)
	knownHosts := filepath.Join(t.TempDir(), "known_hosts")

	if err := AndroidData.Link("127.0.0.1:8423", "s3cret", seed, knownHosts); err != nil {
		t.Fatal(err)
	}
	r := remoteNamed(AndroidData.Name)
	if r == nil || r.Type != "sftp" {
		t.Fatalf("remote after Link: %+v", r)
	}
	line, err := os.ReadFile(knownHosts)
	if err != nil || !strings.HasPrefix(string(line), "[127.0.0.1]:8423 ssh-ed25519 ") {
		t.Fatalf("known_hosts: %q, %v", line, err)
	}

	if err := AndroidData.Unlink(); err != nil {
		t.Fatal(err)
	}
	if remoteNamed(AndroidData.Name) != nil {
		t.Fatal("the remote is still there after Unlink")
	}
}

func TestRcloneCopiesIntoAnAppFolderKeepingTheTime(t *testing.T) {
	root, seed, addr := start(t, false)
	if err := AndroidData.Link(addr, testPassword, seed, filepath.Join(t.TempDir(), "kh")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = AndroidData.Unlink() })

	src := t.TempDir()
	when := time.Date(2023, 1, 2, 3, 4, 5, 0, time.UTC)
	file := filepath.Join(src, "slot1.sav")
	if err := os.WriteFile(file, []byte("progress"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(file, when, when); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	from, err := rclonefs.NewFs(ctx, src)
	if err != nil {
		t.Fatal(err)
	}
	to, err := rclonefs.NewFs(ctx, AndroidData.Name+":com.example/files")
	if err != nil {
		t.Fatal(err)
	}
	if err := sync.CopyDir(ctx, to, from, false); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(root, "com.example", "files", "slot1.sav"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(when) {
		t.Fatalf("modification time %v, want %v", info.ModTime(), when)
	}
}

func TestATargetSomeoneNamedAndroidIsLeftAlone(t *testing.T) {
	if err := remotes.Save(AndroidData.Name, "local", map[string]string{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = remotes.Delete(AndroidData.Name) })
	seed := make([]byte, 32)

	if err := AndroidData.Link("127.0.0.1:8423", "s3cret", seed, filepath.Join(t.TempDir(), "kh")); err == nil {
		t.Fatal("Link took over a remote it did not set up")
	}
	if err := AndroidData.Unlink(); err != nil {
		t.Fatal(err)
	}
	if r := remoteNamed(AndroidData.Name); r == nil || r.Type != "local" {
		t.Fatalf("the person's remote changed: %+v", r)
	}
}

func TestRcloneCopiesOutOfTheWholeDisk(t *testing.T) {
	dir, remote, seed, addr := wholeDisk(t)
	if err := os.MkdirAll(filepath.Join(dir, "DCIM"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "DCIM", "cat.jpg"), []byte("meow"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Root.Link(addr, testPassword, seed, filepath.Join(t.TempDir(), "kh")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = Root.Unlink() })

	ctx := context.Background()
	from, err := rclonefs.NewFs(ctx, Root.Name+":"+remote)
	if err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	to, err := rclonefs.NewFs(ctx, dest)
	if err != nil {
		t.Fatal(err)
	}
	if err := sync.CopyDir(ctx, to, from, false); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dest, "DCIM", "cat.jpg"))
	if err != nil || string(data) != "meow" {
		t.Fatalf("copied %q, %v", data, err)
	}
}

func TestHoldsTellsItsOwnTargetFromOneNamedTheSame(t *testing.T) {
	seed := make([]byte, 32)
	if err := Root.Link("127.0.0.1:8425", "s3cret", seed, filepath.Join(t.TempDir(), "kh")); err != nil {
		t.Fatal(err)
	}
	if !Root.Holds("Root:/storage/emulated/0/DCIM") || !Root.Holds("Root:") {
		t.Error("a side on the target is not counted as its")
	}
	if Root.Holds("/storage/emulated/0") || Root.Holds("Android:com.example") {
		t.Error("a side elsewhere is counted as the target's")
	}
	if err := Root.Unlink(); err != nil {
		t.Fatal(err)
	}
	if err := remotes.Save(Root.Name, "local", map[string]string{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = remotes.Delete(Root.Name) })
	if Root.Holds("Root:/data") {
		t.Error("a target someone named Root is counted as ArrowLoop's")
	}
}
