package remotes

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/object"
)

// compressible is text that every compression level shrinks.
var compressible = bytes.Repeat([]byte("the same line of text, over and over\n"), 4000)

// compressTarget saves a compressed target over a fresh folder and returns
// the target's name and the folder.
func compressTarget(t *testing.T, settings map[string]string) (string, string) {
	t.Helper()
	ownConfig(t)
	dir := t.TempDir()
	settings["remote"] = dir
	const name = "arrowloop-test-compress"
	if err := Save(name, "compress", settings); err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { _ = Delete(name) })
	return name, dir
}

// upload puts compressible text on the target. The upload runs on its own
// goroutine because a stuck encoder does not watch the context.
func upload(t *testing.T, name string) {
	t.Helper()
	ctx := context.Background()
	f, err := rclonefs.NewFs(ctx, name+":")
	if err != nil {
		t.Fatalf("open the target: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		info := object.NewStaticObjectInfo("notes.txt", time.Now(), int64(len(compressible)), true, nil, f)
		_, err := f.Put(ctx, bytes.NewReader(compressible), info)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("upload: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the upload never finished")
	}
}

func TestAZstdTargetWithoutALevelTakesACompressibleFile(t *testing.T) {
	name, _ := compressTarget(t, map[string]string{"mode": "zstd"})
	upload(t, name)
}

func TestAGzipTargetWithoutALevelCompresses(t *testing.T) {
	name, dir := compressTarget(t, map[string]string{})
	upload(t, name)

	stored, err := filepath.Glob(filepath.Join(dir, "notes.txt.*.gz"))
	if err != nil || len(stored) != 1 {
		t.Fatalf("no compressed file on the target: %v %v", stored, err)
	}
	info, err := os.Stat(stored[0])
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() >= int64(len(compressible))/10 {
		t.Errorf("stored %d bytes of %d, which is not compressed", info.Size(), len(compressible))
	}
}

func TestALevelTheModeDoesNotTakeFailsWhenTheTargetOpens(t *testing.T) {
	for _, settings := range []map[string]string{
		{"mode": "zstd", "level": "0"},
		{"mode": "zstd", "level": "9"},
		{"mode": "gzip", "level": "12"},
	} {
		level := settings["level"]
		name, _ := compressTarget(t, settings)
		_, err := rclonefs.NewFs(context.Background(), name+":")
		if err == nil {
			t.Errorf("%s at level %s opened", settings["mode"], level)
			continue
		}
		if !strings.Contains(err.Error(), level) {
			t.Errorf("%s at level %s: the error does not name the level: %v", settings["mode"], level, err)
		}
	}
}
