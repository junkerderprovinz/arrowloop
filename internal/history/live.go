package history

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"
)

// Live is a run that is still going: its record so far and every line it has
// written, held in memory until Record stores them. Log, Entries and Following
// include it, so a run can be followed while it runs and reads the same
// afterwards.
type Live struct {
	db *DB
	id int64

	// Guarded by db.liveMu.
	run     Run
	entries []Entry
}

// live is the state behind the runs still going. settle keeps a run from
// being counted twice: Record holds it while the run moves from memory into
// the table, and every listing holds it for reading.
type live struct {
	settle sync.RWMutex
	liveMu sync.Mutex
	runs   map[int64]*Live
	last   int64
}

// Begin starts following a run. Its id is negative, so it never meets a
// stored run's, and it lasts until Record or Drop.
func (d *DB) Begin(job string, started time.Time) *Live {
	d.liveMu.Lock()
	defer d.liveMu.Unlock()
	if d.runs == nil {
		d.runs = map[int64]*Live{}
	}
	d.last--
	l := &Live{db: d, id: d.last, run: Run{ID: d.last, Job: job, Started: started, Running: true}}
	d.runs[l.id] = l
	return l
}

// Add appends one line and counts it the way the finished record will.
func (l *Live) Add(e Entry) {
	l.db.liveMu.Lock()
	defer l.db.liveMu.Unlock()
	l.entries = append(l.entries, e)
	switch e.Kind {
	case "copy":
		l.run.Copied++
	case "move":
		l.run.Moved++
	case "trash":
		l.run.Trashed++
	case "conflict":
		l.run.Conflicts++
	case "mkdir":
		l.run.DirsMade++
	case "rmdir":
		l.run.DirsRemoved++
	case "skip":
		l.run.Skipped++
	}
}

// Record stores the finished run with the lines gathered so far, and stops
// showing it from memory in the same step.
func (l *Live) Record(ctx context.Context, r Run) error {
	d := l.db
	d.settle.Lock()
	defer d.settle.Unlock()
	d.liveMu.Lock()
	entries := l.entries
	d.liveMu.Unlock()
	err := d.Record(ctx, r, entries)
	l.Drop()
	return err
}

// Drop forgets a run that is not going to be recorded.
func (l *Live) Drop() {
	l.db.liveMu.Lock()
	defer l.db.liveMu.Unlock()
	delete(l.db.runs, l.id)
}

// snapshot returns the runs still going, newest first. Each carries a copy of
// its record and the lines it had written, which later appends leave alone.
func (d *DB) snapshot() []liveCopy {
	d.liveMu.Lock()
	defer d.liveMu.Unlock()
	out := make([]liveCopy, 0, len(d.runs))
	for _, l := range d.runs {
		out = append(out, liveCopy{run: l.run, entries: l.entries[:len(l.entries):len(l.entries)]})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].run.Started.After(out[b].run.Started) })
	return out
}

type liveCopy struct {
	run     Run
	entries []Entry
}

// shows reports whether a run still going belongs in a listing with this
// filter. It has to agree with Show.where.
func (s Show) shows(r Run) bool {
	switch s {
	case ShowChanged:
		return r.Changed() || r.Failed()
	case ShowFailed:
		return r.Failed()
	default:
		return true
	}
}

// liveRuns adds the runs still going to a page of stored runs, in the order the
// query gives, and keeps the page to its limit.
func (d *DB) liveRuns(stored []Run, job string, show Show, since, until time.Time, limit int) []Run {
	var going []Run
	for _, c := range d.snapshot() {
		r := c.run
		if job != "" && r.Job != job || !show.shows(r) {
			continue
		}
		if !since.IsZero() && r.Started.Before(since) || !until.IsZero() && r.Started.After(until) {
			continue
		}
		going = append(going, r)
	}
	if len(going) == 0 {
		return stored
	}
	out := append(going, stored...)
	sort.SliceStable(out, func(a, b int) bool { return out[a].Started.After(out[b].Started) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// liveTouches adds the lines of the runs still going to a page of the file log,
// newest first, and keeps the page to its limit.
func (d *DB) liveTouches(stored []Touch, f Filter, limit int) []Touch {
	kinds := map[string]bool{}
	for _, k := range f.Kinds {
		kinds[k] = true
	}
	needle := foldASCII(f.Contains)
	var going []Touch
	for _, c := range d.snapshot() {
		if f.Job != "" && c.run.Job != f.Job {
			continue
		}
		taken := 0
		for i := len(c.entries) - 1; i >= 0 && taken < limit; i-- {
			e := c.entries[i]
			if len(kinds) > 0 && !kinds[e.Kind] {
				continue
			}
			if needle != "" && !strings.Contains(foldASCII(e.Path), needle) {
				continue
			}
			going = append(going, Touch{Entry: e, Run: c.run.ID, Job: c.run.Job, When: c.run.Started, Seq: i})
			taken++
		}
	}
	if len(going) == 0 {
		return stored
	}
	out := append(going, stored...)
	sort.SliceStable(out, func(a, b int) bool { return out[a].When.After(out[b].When) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// liveEntries returns what a run still going has done so far, or nil when no
// such run is going.
func (d *DB) liveEntries(id int64) []Entry {
	d.liveMu.Lock()
	defer d.liveMu.Unlock()
	l, ok := d.runs[id]
	if !ok {
		return nil
	}
	return append([]Entry(nil), l.entries...)
}

// foldASCII lowers only the ASCII letters, as SQLite's LIKE matches them, so
// a run still going is searched the way the stored ones are.
func foldASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'A' <= c && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}
