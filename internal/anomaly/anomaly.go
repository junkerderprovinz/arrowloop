// Package anomaly keeps what the engine found odd about a job: a run a safety
// brake refused, a job that keeps failing, a schedule that stopped being kept,
// a run far outside what the job usually does.
//
// A finding from a brake holds its job. Every run of it stops at the same
// place until somebody answers the finding or the cause goes away, and the
// answer is recorded with it. The other findings are notes that hold nothing.
package anomaly

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/failure"
)

// Kind is what was found.
type Kind string

// The three brakes hold a job; the rest are notes.
const (
	Delete  Kind = "delete"
	Change  Kind = "change"
	Empty   Kind = "empty"
	Failing Kind = "failing"
	Overdue Kind = "overdue"
	Unusual Kind = "unusual"
)

// Holds reports whether a finding of this kind stops its job.
func (k Kind) Holds() bool { return k == Delete || k == Change || k == Empty }

// Severity is how loud a finding is. A mass deletion is the common, intended
// kind, emptying a download folder, so it warns; files rewritten in bulk and a
// side that lists nothing are what an attack or a missing disk look like.
func (k Kind) Severity() string {
	switch k {
	case Change, Empty:
		return "critical"
	case Overdue:
		return "info"
	}
	return "warning"
}

// How a finding ended.
const (
	Ran          = "ran"          // somebody let the refused change run
	TakenBack    = "takenBack"    // somebody took the refused change back
	Acknowledged = "acknowledged" // somebody has seen a note
	Resolved     = "resolved"     // the cause went away by itself
)

// Kept is how long a closed finding stays listed.
const Kept = 30 * 24 * time.Hour

// PathLimit is how many file names a finding keeps. The count beside them is
// always the whole number.
const PathLimit = 500

// Finding is one thing found about one job.
type Finding struct {
	ID       string `json:"id"`
	Job      string `json:"job"`
	Kind     Kind   `json:"kind"`
	Severity string `json:"severity"`
	Held     bool   `json:"held"`

	// Since is when it was first found and Seen when it was last confirmed.
	Since time.Time `json:"since"`
	Seen  time.Time `json:"seen"`

	// Count is the files a brake counted, the failed runs in a row, or the
	// days a schedule has been missed. Known and Limit are what a brake
	// measured it against.
	Count int `json:"count,omitempty"`
	Known int `json:"known,omitempty"`
	Limit int `json:"limit,omitempty"`

	// OnLeft and OnRight say how many of a brake's files each side would lose
	// or have overwritten. Side is the one that lists nothing.
	OnLeft  int    `json:"onLeft,omitempty"`
	OnRight int    `json:"onRight,omitempty"`
	Side    string `json:"side,omitempty"`

	Paths []string `json:"paths,omitempty"`

	// Figures are what an unusual run did that its job usually does not.
	Figures []Measure `json:"figures,omitempty"`

	// Detail is the last failure's own words.
	Detail string `json:"detail,omitempty"`
	// Failure is what kind of failure Detail names. It is read from Detail
	// where a finding is handed out rather than stored, like a run's.
	Failure *failure.Failure `json:"failure,omitempty"`

	// Mark identifies the refused change, so letting it run covers what was
	// shown and nothing that happened since.
	Mark string `json:"mark,omitempty"`

	// Allowed is set once somebody let the change run. It stays open only
	// while a second brake still refuses the same run, and keeps its say
	// until that one is answered too.
	Allowed bool `json:"allowed,omitempty"`

	Open    bool      `json:"open"`
	Outcome string    `json:"outcome,omitempty"`
	Closed  time.Time `json:"closed,omitzero"`

	// Quiet marks an acknowledged note whose cause is still there, which is
	// not raised again until the cause has gone and come back.
	Quiet bool `json:"quiet,omitempty"`
}

// ErrUnknown is returned for an id no open finding carries.
var ErrUnknown = errors.New("no open finding with that id")

// Store is the list of findings, kept in one small file beside the
// configuration.
type Store struct {
	mu   sync.Mutex
	path string
	list []Finding

	// now is the clock, swapped in tests. Nil means time.Now.
	now func() time.Time
}

// Open reads the findings at path. A missing file is an empty list, and an
// unreadable one is reported and started afresh, since refusing to run over a
// damaged note would be worse than losing it. An empty path keeps the findings
// in memory only.
func Open(path string) (*Store, error) {
	s := &Store{path: path}
	if path == "" {
		return s, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return s, fmt.Errorf("read the findings: %w", err)
	}
	if err := json.Unmarshal(data, &s.list); err != nil {
		s.list = nil
		return s, fmt.Errorf("the findings in %s cannot be read and start afresh: %w", path, err)
	}
	return s, nil
}

func (s *Store) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

// Raise records a finding, or confirms the open one of the same job and kind
// with the new figures. It reports the finding as stored and whether it is
// new, which is when somebody should be told. An acknowledged note whose cause
// never went away is not raised again.
func (s *Store) Raise(f Finding) (Finding, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	if len(f.Paths) > PathLimit {
		f.Paths = f.Paths[:PathLimit]
	}
	for i := range s.list {
		old := &s.list[i]
		if old.Job != f.Job || old.Kind != f.Kind {
			continue
		}
		if old.Open {
			f.ID, f.Since, f.Seen, f.Open = old.ID, old.Since, now, true
			f.Severity, f.Held = f.Kind.Severity(), f.Kind.Holds()
			// A permission covers the change it was given for.
			f.Allowed = old.Allowed && old.Mark == f.Mark
			*old = f
			s.save()
			return f, false
		}
		if old.Quiet {
			return *old, false
		}
	}
	f.ID = strconv.FormatInt(now.UnixNano(), 36)
	f.Since, f.Seen, f.Open = now, now, true
	f.Severity, f.Held = f.Kind.Severity(), f.Kind.Holds()
	s.list = append(s.list, f)
	s.save()
	return f, true
}

// Settle closes the open findings of a job among the given kinds, because
// their cause is gone, and lets an acknowledged note of those kinds be raised
// again. It reports whether anything changed.
func (s *Store) Settle(job, outcome string, kinds ...Kind) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for i := range s.list {
		f := &s.list[i]
		if f.Job != job || !slices.Contains(kinds, f.Kind) {
			continue
		}
		if f.Open {
			f.Open, f.Outcome, f.Closed = false, outcome, s.clock()
			changed = true
		}
		if f.Quiet {
			f.Quiet = false
			changed = true
		}
	}
	if changed {
		s.save()
	}
	return changed
}

// Acknowledge closes a note somebody has seen. A finding that holds its job
// cannot be acknowledged, because the job would stay held with nothing left
// on the screen to say why.
func (s *Store) Acknowledge(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		f := &s.list[i]
		if f.ID != id || !f.Open {
			continue
		}
		if f.Held {
			return errors.New("this finding holds its job, which has to be run or taken back")
		}
		f.Open, f.Outcome, f.Closed, f.Quiet = false, Acknowledged, s.clock(), true
		s.save()
		return nil
	}
	return ErrUnknown
}

// Allow notes that somebody let a refused change run, and returns the marks
// of every change of that job allowed so far.
func (s *Store) Allow(id string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := ""
	for i := range s.list {
		f := &s.list[i]
		if f.ID == id && f.Open && f.Held {
			f.Allowed = true
			job = f.Job
		}
	}
	if job == "" {
		return nil, ErrUnknown
	}
	s.save()
	var marks []string
	for _, f := range s.list {
		if f.Job == job && f.Open && f.Allowed {
			marks = append(marks, f.Mark)
		}
	}
	return marks, nil
}

// Find returns the open finding with this id.
func (s *Store) Find(id string) (Finding, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.list {
		if f.ID == id && f.Open {
			return f, true
		}
	}
	return Finding{}, false
}

// Holding returns the finding that holds a job, if one does.
func (s *Store) Holding(job string) (Finding, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.list {
		if f.Job == job && f.Open && f.Held {
			return f, true
		}
	}
	return Finding{}, false
}

// Has reports whether a job has an open finding of this kind.
func (s *Store) Has(job string, kind Kind) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.list {
		if f.Job == job && f.Open && f.Kind == kind {
			return true
		}
	}
	return false
}

// List returns the open findings, loudest and then oldest first, and the ones
// closed within Kept, newest first. Findings of a job that is not among known
// are dropped for good, as are closed ones past Kept.
func (s *Store) List(known func(job string) bool) (open, closed []Finding) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := s.clock().Add(-Kept)
	kept := s.list[:0]
	for _, f := range s.list {
		if !known(f.Job) || !f.Open && f.Closed.Before(cut) {
			continue
		}
		kept = append(kept, f)
	}
	if len(kept) != len(s.list) {
		s.list = kept
		s.save()
	}
	for _, f := range s.list {
		if f.Open {
			open = append(open, f)
		} else {
			closed = append(closed, f)
		}
	}
	rank := map[string]int{"critical": 0, "warning": 1, "info": 2}
	sort.SliceStable(open, func(a, b int) bool {
		if open[a].Severity != open[b].Severity {
			return rank[open[a].Severity] < rank[open[b].Severity]
		}
		return open[a].Since.Before(open[b].Since)
	})
	sort.SliceStable(closed, func(a, b int) bool { return closed[a].Closed.After(closed[b].Closed) })
	return open, closed
}

// save writes the list beside the real file and renames it into place. A
// failure costs the note and not the run, so it is not returned; the list in
// memory stays right until the program ends.
func (s *Store) save() {
	if s.path == "" {
		return
	}
	data, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return
	}
	tmp := s.path + ".writing"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
	}
}
