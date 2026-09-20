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

func TestALocalFolderReportsItsDisk(t *testing.T) {
	configured(t, "disk", "local", nil)

	// The working directory rather than a temporary folder, whose Windows path
	// would add a second colon to the remote string.
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

// S3 has no About. An error would mark a healthy bucket red, and a usage of zero
// would read as a full disk.
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

func TestNothingKnownIsAbsentOnTheWireRatherThanZero(t *testing.T) {
	raw, err := json.Marshal(Usage{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(raw); got != `{"supported":false}` {
		t.Errorf("an unknown usage travels as %s", got)
	}

	// A full disk has to be reportable.
	zero := int64(0)
	raw, err = json.Marshal(Usage{Supported: true, Free: &zero})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if got := string(raw); got != `{"supported":true,"free":0}` {
		t.Errorf("a genuinely full target travels as %s", got)
	}
}
