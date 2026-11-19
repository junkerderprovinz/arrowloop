// Package joblock keeps two processes, such as the desktop app and a scheduled
// run-due, from running the same job at once. A run holds a lock on a file
// beside the job's state database, which the system drops when the process
// ends, so a crash leaves nothing to clean up.
package joblock

import (
	"fmt"

	"github.com/gofrs/flock"

	"github.com/junkerderprovinz/arrowloop/internal/dbfile"
)

// Take locks the job whose state database is at state. held reports that
// another holder has it, and release is nil then.
func Take(state string) (release func(), held bool, err error) {
	if err := dbfile.EnsureDir(state); err != nil {
		return nil, false, err
	}
	lock := flock.New(state + ".lock")
	ok, err := lock.TryLock()
	if err != nil {
		return nil, false, fmt.Errorf("lock %s: %w", lock.Path(), err)
	}
	if !ok {
		return nil, true, nil
	}
	return func() { _ = lock.Unlock() }, false, nil
}
