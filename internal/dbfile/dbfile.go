// Package dbfile prepares the location of the program's SQLite databases.
//
// SQLite creates a missing database file but not its folder, and reports the
// missing folder only as "unable to open database file" (SQLITE_CANTOPEN). New
// jobs get a state path under "state/", which the config directory does not
// ship with.
package dbfile

import (
	"fmt"
	"os"
	"path/filepath"
)

// EnsureDir creates the folder a database file will live in.
func EnsureDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "" || dir == "." {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create the folder for %s: %w", path, err)
	}
	return nil
}
