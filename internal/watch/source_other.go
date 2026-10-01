//go:build !windows

package watch

import "github.com/fsnotify/fsnotify"

// newSource watches each directory on its own, which is all inotify and
// kqueue offer.
func newSource() (*source, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &source{
		events: fsw.Events,
		errors: fsw.Errors,
		add:    fsw.Add,
		remove: fsw.Remove,
		close:  fsw.Close,
	}, nil
}
