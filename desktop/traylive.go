package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/energye/systray"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

// The tray icon as a reading of what the program is doing, kept current by the
// same event stream the interface watches.
//
// Everything the tray says has to come from that stream rather than from a
// second source of truth. A tray that polled the runner would show a different
// answer from the window beside it every time the two disagreed by a tick, and
// the state somebody actually acts on is the one they can see without opening
// anything.
//
// The state after a run STICKS until the next run starts, and that is the point
// rather than an omission: an icon that returned to neutral a second after a
// failure would only ever be seen by somebody who happened to be looking. The
// colour is the notice, so it stays until there is something newer to say.

// TrayLive owns the icon and the tooltip while the program runs.
type TrayLive struct {
	set *TraySet

	mu      sync.Mutex
	state   TrayState
	frame   int
	working map[string]activity
	last    string
}

// activity is what one job is doing this second, as the tray tells it.
type activity struct {
	path  string
	side  string
	done  int
	total int
}

func newTrayLive(set *TraySet) *TrayLive {
	return &TrayLive{set: set, working: map[string]activity{}}
}

// apply is what the icon and the tooltip should be right now.
//
// Called under the lock by every path that changes anything, so the two can
// never disagree: a tooltip describing a run that has finished is worse than no
// tooltip, because it is a confident wrong answer.
func (l *TrayLive) apply() {
	switch {
	case len(l.working) > 0:
		l.state = TrayWorking
		systray.SetIcon(l.set.Working[l.frame%len(l.set.Working)])
	case l.state == TrayFailed:
		systray.SetIcon(l.set.Failed)
	case l.state == TraySettled:
		systray.SetIcon(l.set.Settled)
	default:
		systray.SetIcon(l.set.Idle)
	}
	systray.SetTooltip(l.tooltip())
}

// tooltip is the one line the shell will show, built under the lock.
func (l *TrayLive) tooltip() string {
	if len(l.working) == 0 {
		if l.last != "" {
			return "ArrowLoop - " + l.last
		}
		return "ArrowLoop"
	}
	// One job is the common case and gets a real sentence. Several get a count,
	// because a tooltip is one line and three truncated paths are no lines.
	if len(l.working) == 1 {
		for job, a := range l.working {
			if a.total > 0 {
				return fmt.Sprintf("ArrowLoop - %s: %d/%d", job, a.done, a.total)
			}
			return "ArrowLoop - " + job
		}
	}
	return fmt.Sprintf("ArrowLoop - %d jobs running", len(l.working))
}

// Watch follows the runner's events for as long as the context lives.
//
// The spin is driven by a ticker rather than by the events themselves, because
// the two answer different questions: the events say what is happening, and a
// job copying one enormous file would otherwise freeze the icon for as long as
// that file took, which reads as a hang.
func (l *TrayLive) Watch(ctx context.Context, runner *daemon.Runner) {
	events, stop := runner.Subscribe()
	go func() {
		defer stop()
		spin := time.NewTicker(80 * time.Millisecond)
		defer spin.Stop()
		for {
			select {
			case <-ctx.Done():
				return

			case <-spin.C:
				l.mu.Lock()
				if len(l.working) > 0 {
					l.frame++
					l.apply()
				}
				l.mu.Unlock()

			case ev, ok := <-events:
				if !ok {
					return
				}
				l.mu.Lock()
				switch ev.Phase {
				case "started":
					l.working[ev.Job] = activity{}
				case "progress":
					a := l.working[ev.Job]
					if ev.Path != "" {
						a.path, a.side = ev.Path, ev.Side
					}
					a.done, a.total = ev.Done, ev.Total
					l.working[ev.Job] = a
				case "finished":
					delete(l.working, ev.Job)
					// A failure outranks a success that arrives after it: with
					// two jobs finishing together, the one worth a colour is the
					// one that went wrong.
					if ev.Error != "" {
						l.state = TrayFailed
						l.last = ev.Job + ": " + ev.Error
					} else if l.state != TrayFailed || len(l.working) == 0 {
						l.state = TraySettled
						l.last = ev.Job + ": done"
					}
				}
				l.apply()
				l.mu.Unlock()
			}
		}
	}()
}

// Activity is what the small window shows: one line per running job.
//
// Returned as plain values rather than as the map itself, so nothing outside
// can read it while an event is being applied.
func (l *TrayLive) Activity() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.working) == 0 {
		if l.last != "" {
			return []string{l.last}
		}
		return nil
	}
	lines := make([]string, 0, len(l.working))
	for job, a := range l.working {
		line := job
		if a.path != "" {
			line += ": " + a.path
			if a.side != "" {
				line += " -> " + a.side
			}
		}
		if a.total > 0 {
			line += fmt.Sprintf(" (%d/%d)", a.done, a.total)
		}
		lines = append(lines, line)
	}
	return lines
}
