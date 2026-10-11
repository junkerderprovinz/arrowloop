// Package dbfile prepares the location of the program's SQLite databases and
// keeps an older build off a database a newer one wrote.
//
// SQLite creates a missing database file but not its folder, and reports the
// missing folder only as "unable to open database file" (SQLITE_CANTOPEN). New
// jobs get a state path under "state/", which the config directory does not
// ship with.
package dbfile

import (
	"context"
	"database/sql"
	"errors"
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

// ErrNewer is returned for a database a newer build wrote: read with this
// build's assumptions and written back, it would lose what the newer one
// keeps.
var ErrNewer = errors.New("written by a newer ArrowLoop; update this one, or go back to the build that wrote it")

// Stamp checks a database's layout version, SQLite's user_version, against
// the one this build writes, and records it on a database that is older or
// new.
func Stamp(ctx context.Context, db *sql.DB, path string, version int) error {
	var have int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&have); err != nil {
		return fmt.Errorf("read the version of %s: %w", path, err)
	}
	if have > version {
		return fmt.Errorf("%s was %w", path, ErrNewer)
	}
	if have < version {
		if _, err := db.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, version)); err != nil {
			return fmt.Errorf("record the version of %s: %w", path, err)
		}
	}
	return nil
}
