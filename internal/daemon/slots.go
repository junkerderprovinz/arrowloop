package daemon

import (
	"context"
	"sync"
)

// slots counts the runs going at once against a limit read each time a run
// asks, so a changed parallelJobs applies without a restart.
type slots struct {
	mu    sync.Mutex
	busy  int
	freed chan struct{}
}

// take waits until fewer than limit runs are going and then counts one more.
func (s *slots) take(ctx context.Context, limit func() int) error {
	for {
		n := limit()
		s.mu.Lock()
		if s.busy < n {
			s.busy++
			s.mu.Unlock()
			return nil
		}
		if s.freed == nil {
			s.freed = make(chan struct{})
		}
		freed := s.freed
		s.mu.Unlock()

		select {
		case <-freed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// give hands a slot back.
func (s *slots) give() {
	s.mu.Lock()
	s.busy--
	s.mu.Unlock()
	s.wake()
}

// wake makes every waiting run look at the limit again.
func (s *slots) wake() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.freed != nil {
		close(s.freed)
		s.freed = nil
	}
}
