package appdocs

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/sftp"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
	"github.com/rclone/rclone/fs/sync"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "arrowloop-appdocs-test")
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

// fakeApp answers like the phone app, for the folders below root.
type fakeApp struct {
	root string
	// cut makes a read stop after the first chunk without ending it.
	cut bool
}

func (f *fakeApp) client() *client {
	return &client{dial: func() (net.Conn, error) {
		ours, theirs := net.Pipe()
		go f.serve(theirs)
		return ours, nil
	}}
}

func (f *fakeApp) serve(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	line, err := r.ReadBytes('\n')
	if err != nil {
		return
	}
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		return
	}
	at := filepath.Join(f.root, filepath.FromSlash(req.Path))
	var a answer
	var body []byte
	switch req.Op {
	case "stat":
		var info fs.FileInfo
		if info, err = os.Stat(at); err == nil {
			e := entryOf(info)
			a.Entry = &e
		}
	case "list":
		var dirents []fs.DirEntry
		dirents, err = os.ReadDir(at)
		for _, d := range dirents {
			if info, err := d.Info(); err == nil {
				a.Entries = append(a.Entries, entryOf(info))
			}
		}
	case "read":
		body, err = os.ReadFile(at)
	case "write":
		var got bytes.Buffer
		if err = readChunks(r, &got); err == nil {
			err = os.WriteFile(at, got.Bytes(), 0o600)
		}
	case "touch":
		when := time.UnixMilli(req.MTime)
		err = os.Chtimes(at, when, when)
	case "mkdir":
		err = os.Mkdir(at, 0o700)
	case "remove", "rmdir":
		err = os.Remove(at)
	case "rename":
		to := filepath.Join(f.root, filepath.FromSlash(req.To))
		if _, there := os.Stat(to); there == nil && !req.Replace {
			err = errors.New(req.To + " already exists")
		} else {
			err = os.Rename(at, to)
		}
	default:
		err = errors.New("unknown op " + req.Op)
	}
	switch {
	case errors.Is(err, fs.ErrNotExist):
		a = answer{Code: "missing"}
	case err != nil:
		a = answer{Error: err.Error()}
	}
	reply, _ := json.Marshal(a)
	w := bufio.NewWriter(conn)
	w.Write(append(reply, '\n'))
	if err == nil && req.Op == "read" {
		if f.cut {
			w.Write([]byte{0, 0, 0, 3, 'a', 'b', 'c'})
		} else {
			writeChunks(w, bytes.NewReader(body))
		}
	}
	w.Flush()
}

func entryOf(info fs.FileInfo) entry {
	return entry{Name: info.Name(), Dir: info.IsDir(), Size: info.Size(), MTime: info.ModTime().UnixMilli()}
}

// shared starts an app sharing one folder called rime and offers it.
func shared(t *testing.T) (*fakeApp, string) {
	t.Helper()
	app := &fakeApp{root: t.TempDir()}
	rime := filepath.Join(app.root, "rime")
	if err := os.Mkdir(rime, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := offer(app.client(), t.TempDir(), filepath.Join(t.TempDir(), "kh")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = Shared.Unlink() })
	return app, rime
}

func remoteFs(t *testing.T, spec string) rclonefs.Fs {
	t.Helper()
	f, err := rclonefs.NewFs(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestRcloneCopiesIntoASharedFolderKeepingTheTime(t *testing.T) {
	_, rime := shared(t)
	src := t.TempDir()
	when := time.Date(2024, 6, 20, 8, 51, 0, 0, time.UTC)
	file := filepath.Join(src, "sub", "rime_ice.userdb.txt")
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("你好 nihao 3"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(file, when, when); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	if err := sync.CopyDir(ctx, remoteFs(t, Shared.Name+":rime"), remoteFs(t, src), false); err != nil {
		t.Fatal(err)
	}

	got := filepath.Join(rime, "sub", "rime_ice.userdb.txt")
	data, err := os.ReadFile(got)
	if err != nil || string(data) != "你好 nihao 3" {
		t.Fatalf("copied file: %q, %v", data, err)
	}
	info, err := os.Stat(got)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(when) {
		t.Fatalf("modification time %v, want %v", info.ModTime(), when)
	}
}

func TestAChangedFileReplacesTheOneInTheSharedFolder(t *testing.T) {
	_, rime := shared(t)
	src := t.TempDir()
	file := filepath.Join(src, "user.dict.txt")
	ctx := context.Background()
	for i, content := range []string{"你好 nihao 3", "你好 nihao 3\n世界 shijie 5"} {
		if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		when := time.Date(2024, 6, 20, 8, 51+i, 0, 0, time.UTC)
		if err := os.Chtimes(file, when, when); err != nil {
			t.Fatal(err)
		}
		if err := sync.CopyDir(ctx, remoteFs(t, Shared.Name+":rime"), remoteFs(t, src), false); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(rime, "user.dict.txt"))
		if err != nil || string(data) != content {
			t.Fatalf("copy %d: %q, %v", i+1, data, err)
		}
	}
}

func TestRcloneReadsASharedFolder(t *testing.T) {
	_, rime := shared(t)
	big := bytes.Repeat([]byte("0123456789"), 20000)
	if err := os.WriteFile(filepath.Join(rime, "default.yaml"), big, 0o600); err != nil {
		t.Fatal(err)
	}
	dst := t.TempDir()
	if err := sync.Sync(context.Background(), remoteFs(t, dst), remoteFs(t, Shared.Name+":rime"), false); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dst, "default.yaml"))
	if err != nil || !bytes.Equal(data, big) {
		t.Fatalf("read %d bytes, want %d: %v", len(data), len(big), err)
	}
}

func TestTheSharedFoldersAreTheTopLevel(t *testing.T) {
	shared(t)
	entries, err := remoteFs(t, Shared.Name+":").List(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Remote() != "rime" {
		t.Fatalf("top level: %v", entries)
	}
}

func TestAReadTheAppBreaksOffFails(t *testing.T) {
	app := &fakeApp{root: t.TempDir(), cut: true}
	if err := os.WriteFile(filepath.Join(app.root, "f"), []byte("abcdef"), 0o600); err != nil {
		t.Fatal(err)
	}
	var got bytes.Buffer
	if _, err := app.client().call(request{Op: "read", Path: "/f"}, nil, &got); err == nil {
		t.Fatalf("a read cut short passed as %q", got.String())
	}
}

func TestSomethingMissingIsReportedAsMissing(t *testing.T) {
	app := &fakeApp{root: t.TempDir()}
	if _, err := app.client().stat("/nothing"); !missing(err) {
		t.Fatalf("stat of nothing: %v", err)
	}
}
