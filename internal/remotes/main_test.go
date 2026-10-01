package remotes

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

// testRcloneConf is the rclone configuration every test in this package
// starts from. Without it the first test to read the remotes would load, and
// Use would copy, the rclone.conf of whoever runs the tests.
var testRcloneConf string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "arrowloop-remotes-test")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	testRcloneConf = filepath.Join(dir, "rclone.conf")
	if err := useRcloneConfig(testRcloneConf); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// useRcloneConfig creates an empty configuration at path and points rclone at
// it.
func useRcloneConfig(path string) error {
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		return fmt.Errorf("create a configuration file: %w", err)
	}
	if err := config.SetConfigPath(path); err != nil {
		return fmt.Errorf("point rclone at it: %w", err)
	}
	configfile.Install()
	return nil
}
