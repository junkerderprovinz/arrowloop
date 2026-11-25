// Package systemlog collects the errors that happen outside a run's own files,
// from rclone, the connections to the servers and the integrations, into the
// history's system log.
package systemlog

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/scrub"
)

// The sources a line can come from.
const (
	Rclone      = "rclone"
	Connection  = "connection"
	Integration = "integration"
)

// maxText is as much of one error as the log keeps, since rclone can quote a
// server's whole answer.
const maxText = 2000

// Store is where the lines go.
type Store interface {
	AddSystemLog(ctx context.Context, lines []history.SystemLine) error
}

// Log writes the lines it is given in the background. A nil Log notes
// nothing.
type Log struct {
	store   Store
	mu      sync.Mutex
	pending []history.SystemLine
	wake    chan struct{}
	stop    chan struct{}
	done    chan struct{}
}

// New starts a log that writes to store until Close.
func New(store Store) *Log {
	l := &Log{store: store, wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
	go l.write()
	return l
}

// Note adds an error to the log, with its secrets left out. It never waits for
// the disk: rclone calls it in the middle of a transfer.
func (l *Log) Note(source, format string, args ...any) {
	if l == nil {
		return
	}
	line := history.SystemLine{At: time.Now(), Source: source, Text: cut(scrub.Text(strings.TrimSpace(fmt.Sprintf(format, args...)))), Count: 1}
	l.mu.Lock()
	if n := len(l.pending); n > 0 && l.pending[n-1].Source == line.Source && l.pending[n-1].Text == line.Text {
		l.pending[n-1].At = line.At
		l.pending[n-1].Count++
	} else {
		// The store keeps no more than this either, so the oldest would go
		// there anyway.
		if n >= history.SystemLogKeep {
			l.pending = l.pending[1:]
		}
		l.pending = append(l.pending, line)
	}
	l.mu.Unlock()
	select {
	case l.wake <- struct{}{}:
	default:
	}
}

func cut(text string) string {
	if len(text) <= maxText {
		return text
	}
	end := maxText
	for end > 0 && !utf8.RuneStart(text[end]) {
		end--
	}
	return text[:end] + "…"
}

func (l *Log) write() {
	defer close(l.done)
	for {
		select {
		case <-l.wake:
			l.flush()
		case <-l.stop:
			l.flush()
			return
		}
	}
}

// flush writes what has come in since the last write in one go. Lines the
// disk refuses are lost, which is better than holding up whoever noted them.
func (l *Log) flush() {
	l.mu.Lock()
	lines := l.pending
	l.pending = nil
	l.mu.Unlock()
	if len(lines) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = l.store.AddSystemLog(ctx, lines)
}

// Close writes the lines still waiting and stops the log. It must come before
// the store closes.
func (l *Log) Close() {
	close(l.stop)
	<-l.done
}
