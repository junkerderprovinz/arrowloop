package main

import (
	"context"
	"log"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// teller shows what the engine found about a job as a notification of the
// system, so a held job is heard of while the window is in the tray.
//
// It wraps the notification service to keep a start that fails from ending the
// program: a desktop without a notification daemon still syncs, and the
// finding still shows in the window.
type teller struct {
	service *notifications.NotificationService
	off     atomic.Bool
}

func newTeller() *teller {
	return &teller{service: notifications.New()}
}

// ServiceStartup starts the notification service and never fails.
func (t *teller) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if err := t.service.ServiceStartup(ctx, options); err != nil {
		log.Printf("no notifications on this desktop: %v", err)
		t.off.Store(true)
	}
	return nil
}

// ServiceShutdown stops the notification service.
func (t *teller) ServiceShutdown() error {
	if t.off.Load() {
		return nil
	}
	return t.service.ServiceShutdown()
}

// watch posts a notification for every finding the engine says is worth one,
// in the words the interface last handed over. A click on it brings the main
// window forward.
func (t *teller) watch(ctx context.Context, runner *daemon.Runner, store *deskset.Store, show func()) {
	t.service.OnNotificationResponse(func(notifications.NotificationResult) { show() })
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
				if ev.Phase != "anomaly" || ev.Told == "" || t.off.Load() {
					continue
				}
				f, open := runner.Finding(ev.Told)
				if !open {
					continue
				}
				if granted, err := t.service.RequestNotificationAuthorization(); err != nil || !granted {
					continue
				}
				err := t.service.SendNotification(notifications.NotificationOptions{
					ID:    f.ID,
					Title: "ArrowLoop",
					Body:  store.Words().Found(f.Job, string(f.Kind), f.Held),
					Sound: sound(),
				})
				if err != nil {
					log.Printf("could not show the notification about %s: %v", f.Job, err)
					continue
				}
				ring()
			}
		}
	}()
}
