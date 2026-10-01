package remotes

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

// TestMain points rclone away from its default rclone.conf before anything
// runs, so a test that forgets ownConfig can neither adopt nor rewrite the
// file of whoever runs the tests.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "remotes-test-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := config.SetConfigPath(filepath.Join(dir, "rclone.conf")); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

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
