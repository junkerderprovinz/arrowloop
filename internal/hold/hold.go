// Package hold carries a reason, reported from outside, to stop automatic runs.
//
// A phone knows whether it is charging and whether its connection is metered,
// but only through Android APIs in Kotlin, so the app reports it here. The
// reason is a sentence rather than a flag: the engine only needs to know
// whether an automatic run may go ahead and what to write in the log. Manual
// runs are never held; the runner only asks before an automatic run.
package hold

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// Stale is how long a report is believed. The app sending reports can be
// killed, and a hold that never expired would block every scheduled run from
// then on. Android reports a change the moment it happens, so ten minutes is
// generous. An expired report lets runs through, like a failing power API on
// the desktop.
const Stale = 10 * time.Minute

// State is what was last reported, and when.
type State struct {
	// Reason is empty when nothing is holding runs back; otherwise it is the
	// reporter's sentence for the log.
	Reason string `json:"reason"`

	// At is when it was reported. Zero means nothing ever has been.
	At time.Time `json:"at"`

	// Stale reports whether At is too old to believe, so a client sees the
	// same judgement the condition makes.
	Stale bool `json:"stale"`
}

// Store is the last report. The HTTP handler and the runner use it from
// different goroutines.
type Store struct {
	mu     sync.RWMutex
	reason string
	at     time.Time

	// now is the clock, swapped in tests. Nil means time.Now.
	now func() time.Time
}

// New returns an empty store that holds nothing.
func New() *Store { return &Store{} }

func (s *Store) clock() time.Time {
	if s.now != nil {
		return s.now()
	}
	return time.Now()
}

// Report records a reason. An empty reason clears the hold.
func (s *Store) Report(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reason = reason
	s.at = s.clock()
}

// State returns the last report with its staleness worked out.
func (s *Store) State() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return State{Reason: s.reason, At: s.at, Stale: s.stale()}
}

// stale reports whether the last report is too old to act on. The caller holds
// the lock.
func (s *Store) stale() bool {
	if s.at.IsZero() {
		return false
	}
	return s.clock().Sub(s.at) > Stale
}

// Condition returns the check to hand the runner. It reads the store on every
// call, so plugging in a charger lets the next scheduled run go ahead.
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
