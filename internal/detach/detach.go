// Package detach lets a stopped run walk away from work that does not listen
// to its context.
//
// An SFTP host works out a checksum by running md5sum over the whole file, and
// rclone waits for that command whatever the context says. On a film that is
// minutes, and a stop has to end the run before then.
package detach

import (
	"context"
	"time"
)

// grace is how long stopped work gets to end on its own. Work that listens to
// its context ends within it and tidies up after itself, closing its files and
// removing what it half wrote.
var grace = 3 * time.Second

// Until runs work and returns its result. Once the context ends, the work has
// the grace period to finish, and after that Until returns the context's error
// and leaves it behind. Work left behind finishes on its own and its result is
// dropped, so it must not need the caller once Until returns.
func Until[T any](ctx context.Context, work func() (T, error)) (T, error) {
	var zero T
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	type result struct {
		v   T
		err error
	}
	done := make(chan result, 1)
	go func() {
		v, err := work()
		done <- result{v, err}
	}()

	select {
	case r := <-done:
		return r.v, r.err
	case <-ctx.Done():
	}
	select {
	case r := <-done:
		return r.v, r.err
	case <-time.After(grace):
		return zero, ctx.Err()
	}
}
