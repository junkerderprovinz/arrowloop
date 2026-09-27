package main

import (
	"context"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

// runEvent is the name the interface listens for, carrying the same JSON the
// /api/events stream sends.
const runEvent = "arrowloop:run"

// bridgeEvery is how often progress reaches the windows. Each event costs a
// trip to the window's UI thread, and a run over small files reports far more
// often than anybody can read.
const bridgeEvery = 100 * time.Millisecond

// bridge carries the runner's events into the windows. The asset server on
// Windows hands a response over only once the handler returns, so the
// /api/events stream never arrives there.
//
// Reading and emitting run apart: an emit waits when a window's queue is full,
// and a reader stuck behind it would let the runner drop events, a finished
// one included. Progress keeps only the newest per job; started and finished
// are kept in order.
type bridge struct {
	mu     sync.Mutex
	queue  []daemon.Event
	latest map[string]daemon.Event
	moving map[string]daemon.Event
	wake   chan struct{}
}

func newBridge() *bridge {
	return &bridge{
		latest: map[string]daemon.Event{},
		moving: map[string]daemon.Event{},
		wake:   make(chan struct{}, 1),
	}
}

// add records one event without ever waiting.
func (b *bridge) add(ev daemon.Event) {
	b.mu.Lock()
	switch ev.Phase {
	case "progress":
		b.latest[ev.Job] = ev
	case "moving":
		b.moving[ev.Job] = ev
	default:
		// Whatever the run reported before it finished is out of date.
		if ev.Phase == "finished" {
			delete(b.latest, ev.Job)
			delete(b.moving, ev.Job)
		}
		b.queue = append(b.queue, ev)
	}
	b.mu.Unlock()

	select {
	case b.wake <- struct{}{}:
	default:
	}
}

// take returns what has gathered, starts and finishes first so a job's
// progress never lands before its start.
func (b *bridge) take() []daemon.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := b.queue
	b.queue = nil
	for job, ev := range b.latest {
		out = append(out, ev)
		delete(b.latest, job)
	}
	for job, ev := range b.moving {
		out = append(out, ev)
		delete(b.moving, job)
	}
	return out
}

// run follows the runner and emits to every window until the context ends.
func (b *bridge) run(ctx context.Context, runner *daemon.Runner, app *application.App) {
	events, stop := runner.Subscribe()
	go func() {
		defer stop()
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-events:
				if !ok {
					return
				}
				b.add(ev)
			}
		}
	}()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-b.wake:
			}
			for _, ev := range b.take() {
				app.Event.Emit(runEvent, ev)
			}
			time.Sleep(bridgeEvery)
		}
	}()
}
