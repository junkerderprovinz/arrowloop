package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/energye/systray"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

// TrayLive owns the icon and the tooltip while the program runs. It follows the
// same event stream the interface watches, so the tray and the window agree. The
// state after a run stays until the next run starts, so a failure is still
// visible to somebody who was not looking at the time.
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

// apply sets the icon and the tooltip together. The caller holds the lock.
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
	// Several jobs get a count, since a tooltip is one line.
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

// Watch follows the runner's events for as long as the context lives. The spin
// runs on a ticker, so copying one large file does not freeze the icon.
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
					// A failure outranks a success that arrives after it while
					// other jobs are still running.
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

// Activity returns one line per running job for the tray panel, copied so
// nothing outside reads the map while an event is being applied.
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
