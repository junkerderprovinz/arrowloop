package remotes

import (
	"os"
	"path/filepath"

	"github.com/rclone/rclone/fs/config"
)

// WHERE THE TARGETS ARE KEPT, and why it stopped being rclone's default.
//
// A target is an rclone remote and lives in an rclone configuration file. That
// part was always right. What was never decided is WHICH file, so rclone used
// its own default - `$HOME/.config/rclone/rclone.conf` - which inside a
// container is part of the container's filesystem and not part of the volume
// anybody mounts.
//
// So every storage target this program has ever saved was destroyed by the next
// container update. Not corrupted, not reported: simply gone, with the jobs that
// pointed at them left pointing at a name nothing answers to. Found by updating
// the container and watching two working targets disappear from the list.
//
// The fix is to keep them beside the engine's OWN configuration, which is the
// directory a person mounts precisely because it is the one they want to
// survive. The package doc's promise - that somebody who already has an
// rclone.conf keeps their remotes - is kept by ADOPTING that file once, on the
// first start that finds one and has nothing of its own yet.

// Use puts rclone's configuration beside the engine's own.
//
// `beside` is the engine's configuration file; the remotes land in the same
// directory under rclone's usual name, so it is still an ordinary rclone.conf
// that the rclone command line can be pointed at.
//
// RCLONE_CONFIG wins, because that is rclone's own documented override and
// somebody who set it meant it.
func Use(beside string) error {
	if os.Getenv("RCLONE_CONFIG") != "" {
		return nil
	}

	dir := filepath.Dir(beside)
	if dir == "" || dir == "." {
		// A bare filename, which is how the container starts: its working
		// directory IS the mounted volume.
		dir = "."
	}
	ours := filepath.Join(dir, "rclone.conf")

	// ADOPT an existing default, once. A desktop install that has been using
	// rclone for years has its remotes there, and moving this program's idea of
	// where they live must not read as "all your targets are gone".
	if _, err := os.Stat(ours); os.IsNotExist(err) {
		if from := config.GetConfigPath(); from != "" && from != ours {
			if data, err := os.ReadFile(from); err == nil && len(data) > 0 {
				// Best effort: a failure here is not worth refusing to start
				// over, because the next save writes a fresh file anyway.
				_ = os.MkdirAll(dir, 0o755)
				_ = os.WriteFile(ours, data, 0o600)
			}
		}
	}

	return config.SetConfigPath(ours)
}
