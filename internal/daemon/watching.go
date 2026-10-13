package daemon

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/rclone/rclone/fs/fspath"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
	"github.com/junkerderprovinz/arrowloop/internal/watch"
)

// newWatcher is watch.New, which a test swaps for one that fails.
var newWatcher = watch.New

// A watcher that would not start is tried again after watchWaitFirst, and
// after twice as long each time it fails again, up to watchWaitMost. Starting
// one walks the whole tree, which is too much to repeat every minute.
const (
	watchWaitFirst = time.Minute
	watchWaitMost  = time.Hour
)

// spot is one local side of a watched job as last seen: the folder to watch,
// or no folder while the side is not there.
type spot struct {
	side string
	root string
	// unplugged is set while the side's drive is not attached.
	unplugged bool
}

// missing says why the side cannot be watched.
func (s spot) missing() string {
	if s.unplugged {
		return volume.Describe(s.side) + " is on a drive that is not attached"
	}
	return volume.Describe(s.side) + " is not there"
}

// localSides returns the sides of a job that live on a real filesystem. It
// parses rather than connects, so starting the daemon does not reach out to a
// remote.
func localSides(j job.Job) []spot {
	var out []spot
	for _, side := range []string{j.Left, j.Right} {
		if side == "" {
			continue
		}
		resolved, err := volume.Resolve(side)
		if err != nil {
			out = append(out, spot{side: side, unplugged: true})
			continue
		}
		parsed, err := fspath.Parse(resolved)
		if err != nil || parsed.ConfigString != "" {
			continue
		}
		abs, err := filepath.Abs(parsed.Path)
		if err != nil {
			continue
		}
		s := spot{side: side}
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			s.root = filepath.Clean(abs)
		}
		out = append(out, s)
	}
	return out
}

// watched is one job's watcher and the sides it covers.
type watched struct {
	w    *watch.Watcher
	stop context.CancelFunc

	// sides is each local side as last seen. One without a root is not
	// watched, and the log has said so.
	sides []spot

	// failed is why the watcher would not start. It is tried again at retry,
	// wait after the last try.
	failed string
	retry  time.Time
	wait   time.Duration
}

// lacked reports whether the watcher went without this side.
func (w *watched) lacked(side string) bool {
	if w == nil {
		return false
	}
	for _, s := range w.sides {
		if s.side == side {
			return s.root == ""
		}
	}
	return false
}

// look compares the sides as last seen with how they are now. A side whose
// folder is gone is marked as not watched; the sides with a folder to watch
// again come back as they were last seen.
func (w *watched) look(seen []spot) (gone, back []spot) {
	for i := range w.sides {
		was := w.sides[i]
		var is spot
		found := false
		for _, s := range seen {
			if s.side == was.side {
				is, found = s, true
			}
		}
		if !found {
			continue
		}
		// A drive back under another letter has lost its watch as well.
		if was.root != "" && is.root != was.root {
			if is.root == "" {
				gone = append(gone, is)
			}
			was = spot{side: was.side, unplugged: is.unplugged}
			w.sides[i] = was
		}
		if was.root == "" && is.root != "" {
			back = append(back, was)
		}
	}
	return gone, back
}

// startWatcher makes one job react to changes as well as to the clock. Only a
// local side can be watched, and the schedule stays behind it. A side that is
// not there is left out until the minute tick finds it. prev is the watcher
// this one replaces, so the log does not repeat what it said about it. The
// watcher lives as long as round; the runs it starts live under ctx.
func (r *Runner) startWatcher(ctx, round context.Context, j job.Job, prev *watched, now time.Time) {
	name := j.Name
	sides := localSides(j)
	if len(sides) == 0 {
		r.log("%s asks to be watched but has no local side; the schedule alone will have to do", name)
		return
	}
	next := &watched{sides: sides}
	var roots []string
	for _, s := range sides {
		switch {
		case s.root != "":
			roots = append(roots, s.root)
		case !prev.lacked(s.side):
			r.log("%s: %s, so it is watched as soon as it is there", name, s.missing())
		}
	}
	if len(roots) == 0 {
		r.setWatcher(name, next)
		return
	}
	opt, err := j.Options()
	if err != nil {
		r.log("%s: %v", name, err)
		return
	}

	w, err := newWatcher(watch.Options{
		Roots:    roots,
		Exclude:  opt.Exclude,
		Settle:   j.SettleFor(),
		Cooldown: 5 * time.Second,
		Log:      func(format string, args ...any) { r.log(name+": "+format, args...) },
	}, func() {
		rec, err := r.RunAutomatically(ctx, name)
		switch {
		case errors.Is(err, ErrAlreadyRunning):
			// The change arrived while the job was already working on it.
		case errors.Is(err, ErrWithdrawn):
			r.log("%s: %v", name, err)
		case err != nil:
			r.log("%s failed after a change: %v", name, err)
		case rec.Changed():
			r.log("%s: %d copied, %d moved, %d trashed after a change", name, rec.Copied, rec.Moved, rec.Trashed)
		}
	})
	if err != nil {
		next.failed = err.Error()
		next.wait = watchWaitFirst
		if prev != nil && prev.failed != "" {
			next.wait = min(2*prev.wait, watchWaitMost)
		}
		next.retry = now.Add(next.wait)
		if prev == nil || prev.failed != next.failed {
			r.log("%s: could not start watching, trying again later: %v", name, err)
		}
		r.setWatcher(name, next)
		return
	}

	// Its own context, so a watcher started again once a side is back can
	// replace it.
	live, stop := context.WithCancel(round)
	next.w, next.stop = w, stop
	r.setWatcher(name, next)

	r.log("%s: watching %d folder(s) across %d local side(s)", name, w.Watching(), len(roots))
	go func() {
		defer w.Close()
		if err := w.Run(live); err != nil {
			r.log("%s: watching stopped: %v", name, err)
		}
	}()
}

func (r *Runner) setWatcher(name string, w *watched) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.watchers == nil {
		r.watchers = map[string]*watched{}
	}
	r.watchers[name] = w
}

// rewatch is the minute tick's look at the watchers: a side that went away is
// noted, a watcher is started again once a side it lacked is back, and one
// that would not start is tried again when its wait is over.
func (r *Runner) rewatch(ctx, round context.Context, now time.Time) {
	r.mu.Lock()
	names := make([]string, 0, len(r.watchers))
	for name := range r.watchers {
		names = append(names, name)
	}
	r.mu.Unlock()
	sort.Strings(names)

	for _, name := range names {
		if round.Err() != nil {
			return
		}
		j, ok := r.config().Find(name)
		if !ok || j.Disabled || !j.Watch {
			continue
		}
		seen := localSides(j)

		r.mu.Lock()
		old := r.watchers[name]
		var gone, back []spot
		due, lost := false, false
		if old != nil {
			if old.failed != "" {
				due = !now.Before(old.retry)
			} else {
				gone, back = old.look(seen)
				// A folder made again under the same path between two ticks
				// looks unchanged here, and its watch ended all the same.
				lost = old.w != nil && old.w.Lost()
			}
		}
		again := due || lost || len(back) > 0
		if again {
			delete(r.watchers, name)
		}
		r.mu.Unlock()

		for _, s := range gone {
			r.log("%s: %s, so it is watched as soon as it is there", name, s.missing())
		}
		if !again {
			continue
		}
		if lost && len(back) == 0 {
			r.log("%s: a watch ended, watching again", name)
		}
		for _, s := range back {
			if s.unplugged {
				r.log("%s: its drive is back, watching it too", name)
			} else {
				r.log("%s: %s is there now, watching it too", name, volume.Describe(s.side))
			}
		}
		if old.stop != nil {
			old.stop()
		}
		r.startWatcher(ctx, round, j, old, now)
	}
}

// muteWatcher stops a job's own writes coming back as a change that runs the
// job again.
func (r *Runner) muteWatcher(name string) {
	r.mu.Lock()
	w := r.watchers[name]
	r.mu.Unlock()
	if w != nil && w.w != nil {
		w.w.Mute()
	}
}
