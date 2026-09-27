package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// TrayLive owns the icon and the tooltip while the program runs. It follows the
// same event stream the interface watches, so the tray and the window agree. The
// state after a run stays until the next run starts, so a failure is still
// visible to somebody who was not looking at the time.
type TrayLive struct {
	set *TraySet

	mu      sync.Mutex
	tray    *application.SystemTray
	state   TrayState
	frame   int
	working map[string]activity
	last    outcome
	paused  bool
	words   deskset.Words
}

// activity is how far one job has got, as the tooltip tells it.
type activity struct {
	done  int
	total int
}

// outcome is the last run to finish, kept as facts so the tooltip can be
// worded again when the language changes.
type outcome struct {
	job string
	err string
}

func newTrayLive(set *TraySet) *TrayLive {
	return &TrayLive{set: set, working: map[string]activity{}, words: deskset.DefaultWords()}
}

// attach hands over the icon to draw on, or nil while there is none.
func (l *TrayLive) attach(tray *application.SystemTray) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tray = tray
	l.apply()
}

// show takes the pause and the words from the settings.
func (l *TrayLive) show(paused bool, words deskset.Words) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.paused = paused
	l.words = words
	l.apply()
}

// apply sets the icon and the tooltip together. The caller holds the lock.
// Work in progress outranks the pause, since a run started by hand still goes.
func (l *TrayLive) apply() {
	if l.tray == nil {
		return
	}
	var icon []byte
	switch {
	case len(l.working) > 0:
		icon = l.set.Working[l.frame%len(l.set.Working)]
	case l.paused:
		icon = l.set.Paused
	case l.state == TrayFailed:
		icon = l.set.Failed
	case l.state == TraySettled:
		icon = l.set.Settled
	default:
		icon = l.set.Idle
	}
	l.tray.SetIcon(icon)
	l.tray.SetTooltip(l.tooltip())
}

// tooltip is the one line the shell will show, built under the lock.
func (l *TrayLive) tooltip() string {
	switch len(l.working) {
	case 0:
		switch {
		case l.paused:
			return "ArrowLoop - " + l.words.Paused
		case l.last.job == "":
			return "ArrowLoop"
		case l.last.err != "":
			return "ArrowLoop - " + l.last.job + ": " + l.last.err
		default:
			return "ArrowLoop - " + l.last.job + ": " + l.words.Done
		}
	case 1:
		for job, a := range l.working {
			if a.total > 0 {
				return fmt.Sprintf("ArrowLoop - %s: %d/%d", job, a.done, a.total)
			}
			return "ArrowLoop - " + job
		}
	}
	// Several jobs get a count, since a tooltip is one line.
	return "ArrowLoop - " + strings.ReplaceAll(l.words.Running, "{count}", strconv.Itoa(len(l.working)))
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
				l.follow(ev)
				l.apply()
				l.mu.Unlock()
			}
		}
	}()
}

// follow records one event. The caller holds the lock.
func (l *TrayLive) follow(ev daemon.Event) {
	switch ev.Phase {
	case "started":
		l.working[ev.Job] = activity{}
	case "progress":
		l.working[ev.Job] = activity{done: ev.Done, total: ev.Total}
	case "finished":
		delete(l.working, ev.Job)
		// A failure outranks a success that arrives after it while other
		// jobs are still running.
		if ev.Error != "" {
			l.state = TrayFailed
			l.last = outcome{job: ev.Job, err: ev.Error}
		} else if l.state != TrayFailed || len(l.working) == 0 {
			l.state = TraySettled
			l.last = outcome{job: ev.Job}
		}
	}
}
