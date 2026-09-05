// Package watch notices when a folder changes, so a job can run because
// something happened rather than because a clock struck.
//
// This is worth having for one reason only, and it is not latency. A schedule
// has to list both sides in full on every tick, which on a large tree or over
// a network is most of what a run costs. Watching lets the engine sit still
// until there is a reason not to.
//
// It is deliberately not a replacement for the schedule. Only a local side can
// be watched at all, most remote backends have no way to tell anyone anything,
// and a watcher that missed an event has no way to know it did. Every job keeps
// its schedule as the thing that eventually notices what the watcher did not.
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
	// Roots are the local directories to watch. A remote side contributes
	// none, and a job with no local side at all cannot be watched.
	Roots []string

	// Exclude hides paths from the watcher exactly as it hides them from the
	// job. Without this a folder full of temporary files would keep waking a
	// job that has been told to ignore every one of them.
	Exclude *filter.Set

	// Settle is how long the tree has to go quiet before the change is
	// reported. Copying a folder produces one event per file, and a run per
	// event would be a thousand runs for one action.
	Settle time.Duration

	// Cooldown is how long events are ignored after a change has been
	// reported. A sync writes files, which the watcher sees, which would
	// report another change, which would sync again. The second run finds
	// nothing to do, so it terminates either way, but a job that answers every
	// one of its own writes is a job that never sits still.
	Cooldown time.Duration

	// Log receives anything worth saying out loud. Optional.
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
// nothing to watch, because a job configured to watch and silently watching
// nothing is worse than one that says so.
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

// Mute stops events being reported for the cooldown period, starting now.
//
// The runner calls this around a run of its own. Without it the engine's own
// writes come straight back as changes, and the job spends its life answering
// itself.
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

// Run reports changes until the context is cancelled.
//
// Events are collected rather than acted on one by one: a folder dropped into a
// watched tree produces one event per file, and the interesting fact is that
// something changed, not how many times.
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
			// A new directory has to be watched itself: the kernel reports on
			// a directory's own entries, not on its whole subtree, so a folder
			// created and then filled would otherwise go unnoticed.
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
			// A watch error is worth saying out loud and never worth stopping
			// for: the schedule is still there, so the worst case is that this
			// job goes back to noticing things late rather than not at all.
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
			// A directory that cannot be read is not a reason to give up on
			// the rest of the tree. It will be reported by the listing, which
			// has a better message for it.
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

// Watching reports how many directories are being watched, which is the number
// that matters when somebody asks why the process has so many open handles.
func (w *Watcher) Watching() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.watched)
}
