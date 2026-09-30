package remotes

import (
	"os"
	"path/filepath"

	"github.com/rclone/rclone/fs/config"
)

// Use puts rclone's configuration in an rclone.conf beside the engine's own
// configuration file. rclone's default path inside a container is not on the
// mounted volume, so every target would vanish with the next update.
// RCLONE_CONFIG, rclone's documented override, wins. rclone applies it only
// through its command line flags, so a library user has to set it itself.
func Use(beside string) error {
	if env := os.Getenv("RCLONE_CONFIG"); env != "" {
		return config.SetConfigPath(env)
	}

	dir := filepath.Dir(beside)
	if dir == "" || dir == "." {
		// The container starts with the mounted volume as its working
		// directory.
		dir = "."
	}
	ours := filepath.Join(dir, "rclone.conf")

	// Adopt the default file once, so a desktop that has used rclone for years
	// keeps its remotes.
	if _, err := os.Stat(ours); os.IsNotExist(err) {
		if from := config.GetConfigPath(); from != "" && from != ours {
			if data, err := os.ReadFile(from); err == nil && len(data) > 0 {
				// Best effort: the next save writes a fresh file anyway.
				_ = os.MkdirAll(dir, 0o755)
				_ = os.WriteFile(ours, data, 0o600)
			}
		}
	}

	return config.SetConfigPath(ours)
}
