// Package shadow reads files another program holds open from a shadow copy of
// their volume: a frozen view Windows keeps beside the live one while the live
// files go on changing. Only Windows has such copies, and only a process with
// administrator rights may take one.
package shadow

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// ErrNeedsAdmin is why a shadow copy was not taken for a process without
// administrator rights, which the service has and the desktop app usually
// does not.
var ErrNeedsAdmin = errors.New("taking a shadow copy needs administrator rights")

// Set holds the shadow copies one run has taken, one per volume, each taken the
// first time a file on that volume is found held open. Close removes them.
type Set struct {
	mu     sync.Mutex
	copies map[string]*taken
}

type taken struct {
	id, device string
	err        error
}

// New returns an empty Set, or nil where no shadow copy can be taken at all.
func New() *Set {
	if !supported {
		return nil
	}
	return &Set{copies: map[string]*taken{}}
}

// Root returns a local directory as the shadow copy of its volume shows it.
// A volume whose copy could not be taken keeps answering with that error, so
// a run with a thousand open files does not try a thousand times.
func (s *Set) Root(ctx context.Context, dir string) (string, error) {
	volume, rest, err := split(dir)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.copies[volume]
	if !ok {
		c = &taken{}
		c.id, c.device, c.err = create(ctx, volume)
		s.copies[volume] = c
	}
	if c.err != nil {
		return "", c.err
	}
	return c.device + rest, nil
}

// Close removes every shadow copy the run took. Each one holds disk space on
// its volume for as long as it exists.
func (s *Set) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var errs []error
	for volume, c := range s.copies {
		if c.err == nil {
			if err := remove(ctx, c.id); err != nil {
				errs = append(errs, fmt.Errorf("remove the shadow copy of %s: %w", volume, err))
			}
		}
		delete(s.copies, volume)
	}
	return errors.Join(errs...)
}

// split takes a drive path apart into its volume, "C:", and the rest,
// "\Users\me". The extended-length prefix rclone uses is accepted.
func split(dir string) (volume, rest string, err error) {
	p := strings.ReplaceAll(dir, "/", `\`)
	p = strings.TrimPrefix(p, `\\?\`)
	if len(p) < 2 || p[1] != ':' || !isLetter(p[0]) {
		return "", "", fmt.Errorf("%s is not on a local drive, and only a drive has shadow copies", dir)
	}
	rest = p[2:]
	if !strings.HasPrefix(rest, `\`) {
		rest = `\` + rest
	}
	return strings.ToUpper(p[:2]), strings.TrimSuffix(rest, `\`), nil
}

func isLetter(b byte) bool { return (b|0x20) >= 'a' && (b|0x20) <= 'z' }
