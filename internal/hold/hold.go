// Package hold carries a reason, reported from outside, to stop automatic runs.
//
// It exists because a phone knows two things the engine cannot ask about and
// the desktop can: whether it is charging, and whether this connection is one
// somebody pays for by the megabyte. Android answers both through APIs that
// live in Kotlin, so the answer has to travel rather than be looked up, and
// this is where it lands.
//
// The reason is a SENTENCE rather than a flag, and that is the whole design.
// "on battery" and "on mobile data" are different facts about a phone, a future
// build might add a third, and the engine has no business knowing which is
// which. It needs one question answered: may an automatic run go ahead, and if
// not, what does somebody read in the log.
//
// A run somebody started by hand is never held. That rule lives in the runner,
// which only asks a condition before an AUTOMATIC run - pressing the button on
// mobile data is a decision, and a program that argued with it would be wrong.
package hold

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Stale is how long a report is believed.
//
// A report has to expire, because the thing that sends them can be killed. An
// app swiped away while the phone was on battery would otherwise leave "on
// battery" standing forever, and every scheduled run afterwards would be held
// by a phone that has been on the charger for a week. Ten minutes is longer
// than the gap between two reports by a wide margin - Android sends a broadcast
// the moment a cable goes in - and short enough that a silence is noticed
// before it costs a night's syncing.
//
// Expiring means LETTING RUNS THROUGH, which is the same direction the desktop
// chose for a power API that returns an error: a condition that blocks when it
// cannot tell is a condition that stops everything the day something breaks,
// and nobody would connect the two.
const Stale = 10 * time.Minute

// State is what was last reported, and when.
type State struct {
	// Reason is empty when nothing is holding runs back. When it is not empty
	// it is a sentence somebody reads in the log, in the reporter's words.
	Reason string `json:"reason"`

	// At is when it was reported. Zero means nothing ever has been.
	At time.Time `json:"at"`

	// Stale reports whether At is too old to believe. Written on the way out
	// only, so a client sees the same judgement the condition makes.
	Stale bool `json:"stale"`
}

// Store is the last report, read and written under a lock: the HTTP handler and
// the runner's goroutine are not the same one.
type Store struct {
	mu     sync.RWMutex
	reason string
	at     time.Time

	// now is the clock, swapped in tests. Nil means time.Now.
	now func() time.Time
}

// New builds an empty store: nothing reported, nothing held.
func New() *Store { return &Store{} }

func (s *Store) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

// Report records what the outside world says. An empty reason clears the hold.
func (s *Store) Report(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reason = reason
	s.at = s.clock()
}

// State is what was last reported, with the staleness already worked out.
func (s *Store) State() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return State{Reason: s.reason, At: s.at, Stale: s.stale()}
}

// stale reports whether the last report is too old to act on. Caller holds the
// lock. A store nothing has ever reported to is not stale, it is empty, and an
// empty store holds nothing anyway.
func (s *Store) stale() bool {
	if s.at.IsZero() {
		return false
	}
	return s.clock().Sub(s.at) > Stale
}

// Condition is the check to hand the runner.
//
// It reads the store on every call rather than closing over a value, because
// somebody plugging in a charger expects the next scheduled run to go ahead,
// not the one after a restart.
func (s *Store) Condition() func(context.Context, job.Job) error {
	return func(context.Context, job.Job) error {
		s.mu.RLock()
		defer s.mu.RUnlock()
		if s.reason == "" || s.stale() {
			return nil
		}
		return errors.New(s.reason)
	}
}
