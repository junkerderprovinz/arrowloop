package daemon

import (
	"errors"
	"fmt"
	"path/filepath"
)

// ErrNoFileAccess is returned for a folder on this machine the system keeps the
// engine from reading. Android does that without an error: a process without
// all-files access sees the shared folders with every other app's files left
// out, so a side would read as empty and the run would succeed having done
// nothing.
var ErrNoFileAccess = errors.New("this app may not read the files on this phone")

// Access reports whether a folder on this machine can be read, returning
// ErrNoFileAccess when the system refuses it. Only the phone build sets one.
type Access func(path string) error

// SetAccess installs the check, asked before every run and preview opens its
// sides. Passing nil removes it.
func (r *Runner) SetAccess(a Access) {
	r.condMu.Lock()
	defer r.condMu.Unlock()
	r.access = a
}

// readable checks the sides that are folders on this machine. A target is
// reached over its own connection, whatever the phone allows.
func (r *Runner) readable(left, right string) error {
	r.condMu.Lock()
	check := r.access
	r.condMu.Unlock()
	if check == nil {
		return nil
	}
	for _, side := range [...]struct{ name, path string }{{"left", left}, {"right", right}} {
		if !filepath.IsAbs(side.path) {
			continue
		}
		if err := check(side.path); err != nil {
			return fmt.Errorf("%s side %q: %w", side.name, side.path, err)
		}
	}
	return nil
}
