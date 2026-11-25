package systemlog

import (
	"context"
	"log/slog"

	"github.com/rclone/rclone/fs"
	rclonelog "github.com/rclone/rclone/fs/log"
)

// CatchRclone notes every error rclone logs, which it still writes where it
// always has.
func (l *Log) CatchRclone() {
	fs.SetLogger(handler{inner: rclonelog.Handler, log: l})
}

type handler struct {
	inner slog.Handler
	log   *Log
}

func (h handler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h handler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level >= slog.LevelError {
		text := r.Message
		r.Attrs(func(a slog.Attr) bool {
			if a.Key != "object" {
				return true
			}
			if object := a.Value.String(); object != "" {
				text = object + ": " + text
			}
			return false
		})
		h.log.Note(Rclone, "%s", text)
	}
	return h.inner.Handle(ctx, r)
}

func (h handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return handler{inner: h.inner.WithAttrs(attrs), log: h.log}
}

func (h handler) WithGroup(name string) slog.Handler {
	return handler{inner: h.inner.WithGroup(name), log: h.log}
}
