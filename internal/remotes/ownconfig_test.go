package remotes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

// ownConfig gives the test an empty rclone.conf that nothing else uses.
func ownConfig(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := config.SetConfigPath(path); err != nil {
		t.Fatalf("point at the config: %v", err)
	}
	configfile.Install()
}
