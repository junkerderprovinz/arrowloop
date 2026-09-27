package main

import (
	"context"
	"errors"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

var errPaused = errors.New("sync is paused")

// pausable holds every automatic run while the tray's pause is on, and asks
// the machine's own condition otherwise. It reads the store on each call, so a
// pause applies to the very next run. A nil condition asks nothing more.
func pausable(store *deskset.Store, machine daemon.Condition) daemon.Condition {
	return func(ctx context.Context, j job.Job) error {
		if store.Get().Paused {
			return errPaused
		}
		if machine == nil {
			return nil
		}
		return machine(ctx, j)
	}
}
