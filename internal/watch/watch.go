// Package watch notices when a folder changes, so a job can run because
// something happened rather than because a clock struck. A scheduled run lists
// both sides in full, which is most of its cost on a large tree.
//
// It does not replace the schedule: only local sides can be watched, and a
// watcher cannot know about an event it missed.
package watch

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/junkerderprovinz/arrowloop/internal/filter"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// Options configures one watcher.
type Options struct {
	// Roots are the local directories to watch.
	Roots []string

	// Exclude hides paths from the watcher as it hides them from the job.
	Exclude *filter.Set

	// Settle is how long the tree has to go quiet before a change is reported,
	// so copying a folder is one change rather than one per file.
	Settle time.Duration

	// Cooldown is how long events are ignored after Mute, so a run's own
	// writes do not start another run.
	Cooldown time.Duration

	// Log receives warnings. Optional.
	Log func(format string, args ...any)
}

// Watcher reports that something under its roots changed.
type Watcher struct {
	opt     Options
	fsw     *fsnotify.Watcher
	onEvent func()

	mu      sync.Mutex
	muted   time.Time
	watched map[string]bool
}

// New builds a watcher over the given roots. It returns an error when there is
// nothing to watch.
func New(opt Options, onEvent func()) (*Watcher, error) {
	if len(opt.Roots) == 0 {
		return nil, errors.New("nothing local to watch: a remote side cannot report its own changes")
	}
	if opt.Settle <= 0 {
		opt.Settle = 2 * time.Second
	}
	if opt.Cooldown <= 0 {
		opt.Cooldown = 5 * time.Second
	}
	if opt.Log == nil {
		opt.Log = func(string, ...any) {}
	}

	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("start watching: %w", err)
	}
	w := &Watcher{opt: opt, fsw: fsw, onEvent: onEvent, watched: map[string]bool{}}
	for _, root := range opt.Roots {
		if err := w.addTree(root); err != nil {
			fsw.Close()
			return nil, err
		}
	}
	return w, nil
}

// Close releases the underlying watches.
func (w *Watcher) Close() error { return w.fsw.Close() }

// Mute stops events being reported for the cooldown period, starting now. The
// runner calls it around its own runs.
func (w *Watcher) Mute() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.muted = time.Now().Add(w.opt.Cooldown)
}

func (w *Watcher) isMuted() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return time.Now().Before(w.muted)
}

// Run reports changes until the context is cancelled. Events within the settle
// window are reported once.
func (w *Watcher) Run(ctx context.Context) error {
	var timer *time.Timer
	var fire <-chan time.Time

	for {
		select {
		case <-ctx.Done():
			return nil

		case ev, open := <-w.fsw.Events:
			if !open {
				return nil
			}
			if !w.interesting(ev) {
				continue
			}
			// Watches do not cover subtrees, so a new directory needs its own.
			if ev.Has(fsnotify.Create) {
				if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
					if err := w.addTree(ev.Name); err != nil {
						w.opt.Log("could not watch the new folder %s: %v", ev.Name, err)
					}
				}
			}
			if timer == nil {
				timer = time.NewTimer(w.opt.Settle)
				fire = timer.C
			} else {
				timer.Reset(w.opt.Settle)
			}

		case <-fire:
			timer, fire = nil, nil
			if w.isMuted() {
				continue
			}
			w.onEvent()

		case err, open := <-w.fsw.Errors:
			if !open {
				return nil
			}
			// The schedule still catches what the watcher misses.
			w.opt.Log("watch error: %v", err)
		}
	}
}

// interesting filters out the events that are the engine's own doing or that
// the job was told to ignore.
func (w *Watcher) interesting(ev fsnotify.Event) bool {
	if ev.Op == 0 {
		return false
	}
	for _, root := range w.opt.Roots {
		rel, err := filepath.Rel(root, ev.Name)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		rel = filepath.ToSlash(rel)
		if scan.IsReserved(rel) {
			return false
		}
		if w.opt.Exclude.Excluded(rel) {
			return false
		}
		return true
	}
	return true
}

// addTree watches a directory and everything already under it.
func (w *Watcher) addTree(root string) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			// An unreadable subdirectory is left to the listing to report.
			if p == root {
				return err
			}
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr == nil {
			rel = filepath.ToSlash(rel)
			if rel != "." && (scan.IsReserved(rel) || w.opt.Exclude.Excluded(rel)) {
				return filepath.SkipDir
			}
		}
		w.mu.Lock()
		already := w.watched[p]
		w.mu.Unlock()
		if already {
			return nil
		}
		if err := w.fsw.Add(p); err != nil {
			w.opt.Log("could not watch %s: %v", p, err)
			return nil
		}
		w.mu.Lock()
		w.watched[p] = true
		w.mu.Unlock()
		return nil
	})
}

// Watching reports how many directories are being watched.
func (w *Watcher) Watching() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.watched)
}
