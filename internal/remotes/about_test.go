package remotes

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/rclone/rclone/backend/local"
	_ "github.com/rclone/rclone/backend/s3"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

// "Unknown" and "zero" are different answers, and this is where they part.
//
// A bucket store has no size at all: S3 will take another terabyte and has no
// quota to report. A full disk reports no free space, which is a real number
// and an emergency. Both arrive at the screen as an absent field or a zero, and
// a type that cannot tell them apart puts "0 bytes free" on a target that has
// no limit.

func configured(t *testing.T, name, backend string, settings map[string]string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "rclone.conf")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := config.SetConfigPath(path); err != nil {
		t.Fatalf("point at the config: %v", err)
	}
	configfile.Install()
	if err := Save(name, backend, settings); err != nil {
		t.Fatalf("save %s: %v", name, err)
	}
}

// TestALocalFolderReportsItsDisk.
//
// The local backend implements About, so this is the case where a real number
// is expected, and the shape of that number matters: a total of zero would pass
// a test that only checks for the absence of an error.
func TestALocalFolderReportsItsDisk(t *testing.T) {
	configured(t, "disk", "local", nil)

	// "disk:" with no path is the working directory, which is on a real disk on
	// every machine this ever runs on. A temporary folder appended after the
	// colon would be a SECOND colon on Windows (`disk:C:\Users\...`), and rclone
	// reads the remote string, not the intent.
	usage, err := About(context.Background(), "disk")
	if err != nil {
		t.Fatalf("a local disk refused to report its size: %v", err)
	}
	if !usage.Supported {
		t.Fatal("the local backend was reported as unable to say how full a disk is")
	}
	if usage.Total == nil || *usage.Total <= 0 {
		t.Errorf("a real disk reported a total of %v", usage.Total)
	}
	if usage.Free == nil {
		t.Error("a real disk reported no free space at all, which is not the same as none free")
	}
}

// TestABackendThatCannotSaySaysSo.
//
// S3 has no About, and this is the answer most cloud targets give. It must come
// back as "not supported" rather than as an error - an error would put a red
// line on a perfectly healthy bucket - and it must NOT come back as a usage of
// zero, which would read as a full disk.
func TestABackendThatCannotSaySaysSo(t *testing.T) {
	configured(t, "bucket", "s3", map[string]string{
		"provider":          "Other",
		"access_key_id":     "nothing",
		"secret_access_key": "nothing",
		"endpoint":          "http://127.0.0.1:1", // Never connected to: About is refused before any request.
	})

	usage, err := About(context.Background(), "bucket:")
	if err != nil {
		t.Fatalf("a backend without About reported an error: %v", err)
	}
	if usage.Supported {
		t.Fatal("claimed a bucket store can report its size")
	}
	if usage.Total != nil || usage.Free != nil || usage.Used != nil {
		t.Errorf("carried numbers it cannot know: %+v", usage)
	}
}

// TestNothingKnownIsAbsentOnTheWireRatherThanZero.
//
// The pointers exist for the JSON. Written as plain int64 the same struct sends
// `"free": 0` for a target that has no idea, and every screen that draws it
// then draws a full disk.
func TestNothingKnownIsAbsentOnTheWireRatherThanZero(t *testing.T) {
	raw, err := json.Marshal(Usage{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(raw); got != `{"supported":false}` {
		t.Errorf("an unknown usage travels as %s", got)
	}

	// And a real zero survives, because a full disk has to be reportable.
	zero := int64(0)
	raw, err = json.Marshal(Usage{Supported: true, Free: &zero})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(raw); got != `{"supported":true,"free":0}` {
		t.Errorf("a genuinely full target travels as %s", got)
	}
}
