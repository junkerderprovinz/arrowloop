// Package joblock keeps two processes, such as the desktop app and a scheduled
// run-due, from running the same job at once. A run holds a lock on a file
// named after the job's id, which the system drops when the process ends, so
// a crash leaves nothing to clean up.
package joblock

import (
	"fmt"
	"path/filepath"

	"github.com/gofrs/flock"

	"github.com/junkerderprovinz/arrowloop/internal/dbfile"
)

// Take locks the job filed under key in dir. held reports that another holder
// has it, and release is nil then.
func Take(dir, key string) (release func(), held bool, err error) {
	path := filepath.Join(dir, key+".lock")
	if err := dbfile.EnsureDir(path); err != nil {
		return nil, false, err
	}
	lock := flock.New(path)
	ok, err := lock.TryLock()
	if err != nil {
		return nil, false, fmt.Errorf("lock %s: %w", lock.Path(), err)
	}
	if !ok {
		return nil, true, nil
	}
	return func() { _ = lock.Unlock() }, false, nil
}
