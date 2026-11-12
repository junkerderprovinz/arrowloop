package state

import (
	"context"
	"database/sql"
	"fmt"
	"os"
)

// Snapshot writes a consistent copy of the database at path to dest, while a
// run may be writing to it. Copying the file would miss what still sits in
// its write-ahead log. A database that was never written is fs.ErrNotExist.
func Snapshot(ctx context.Context, path, dest string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	handle, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer handle.Close()
	if _, err := handle.ExecContext(ctx, `VACUUM INTO ?`, dest); err != nil {
		return fmt.Errorf("copy %s: %w", path, err)
	}
	return nil
}
