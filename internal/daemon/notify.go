package daemon

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/notify"
)

// Notifier builds the destination list from the configuration: every channel
// that is switched on and filled in. Nothing to send to returns nil. Whether
// a message goes out at all is decided where it is made.
func Notifier(cfg *job.Config) notify.Notifier {
	n := cfg.Notify
	var out notify.Multi
	if n.Matrix.On() {
		out = append(out, matrixOf(n.Matrix))
	}
	if n.WebhookOn() {
		out = append(out, &notify.Webhook{URL: n.Webhook, Format: n.WebhookFormat})
	}
	if n.SMTP.On() {
		out = append(out, smtpOf(n.SMTP))
	}
	if n.Apprise.On() {
		out = append(out, &notify.Apprise{URL: n.Apprise.URL, Tags: n.Apprise.Tags})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func matrixOf(m *job.Matrix) *notify.Matrix {
	return &notify.Matrix{Homeserver: m.Homeserver, Room: m.Room, Token: m.Token}
}

func smtpOf(s *job.SMTP) *notify.SMTP {
	return &notify.SMTP{Host: s.Host, Port: s.Port, Username: s.Username, Password: s.Password, From: s.From, To: s.To, TLS: s.TLS}
}

// tell sends a message and logs what could not be delivered. The run's own
// context may be cancelled by a stop, and a stopped run is still reported.
func (r *Runner) tell(ctx context.Context, name string, msg notify.Message) {
	r.mu.Lock()
	note := r.note
	r.mu.Unlock()
	if note == nil {
		return
	}
	if err := note.Send(context.WithoutCancel(ctx), msg); err != nil {
		r.log("could not send the notification for %s: %v", name, err)
	}
}

// checkIn pings the job's Healthchecks check that a run began and returns
// what ends it. The start goes out beside the run rather than ahead of it, so
// a check server that is slow to answer does not delay the copying; the end
// waits for the start, or the check would see them the wrong way round.
func (r *Runner) checkIn(ctx context.Context, name string) func(ok bool, detail string) {
	address := r.config().Notify.CheckFor(name)
	if address == "" {
		return func(bool, string) {}
	}
	check := notify.Healthchecks{URL: address}
	ctx = context.WithoutCancel(ctx)
	started := make(chan struct{})
	go func() {
		defer close(started)
		if err := check.Start(ctx); err != nil {
			r.log("could not tell the check for %s that a run began: %v", name, err)
		}
	}()
	return func(ok bool, detail string) {
		<-started
		if err := check.Finish(ctx, ok, detail); err != nil {
			r.log("could not tell the check for %s how the run ended: %v", name, err)
		}
	}
}

// summary is what a run did, in a few lines.
func summary(rec history.Run, res apply.Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d copied, %d moved, %d trashed, %d conflicts", rec.Copied, rec.Moved, rec.Trashed, rec.Conflicts)
	if rec.DirsMade+rec.DirsRemoved > 0 {
		fmt.Fprintf(&b, ", %d folders made, %d removed", rec.DirsMade, rec.DirsRemoved)
	}
	fmt.Fprintf(&b, ", %d unchanged, took %s", rec.Unchanged, rec.Finished.Sub(rec.Started).Round(time.Millisecond))
	if rec.Err != "" {
		fmt.Fprintf(&b, "\n%s", rec.Err)
	}
	// Only a handful of the postponed paths go to the chat room.
	if n := len(res.Skipped); n > 0 {
		fmt.Fprintf(&b, "\n%d left for the next run", n)
		for i, s := range res.Skipped {
			if i == 5 {
				fmt.Fprintf(&b, "\n  and %d more", n-i)
				break
			}
			fmt.Fprintf(&b, "\n  %s: %s", s.Path, s.Reason)
		}
	}
	return b.String()
}

// announce tells whoever is watching about a finished run, if the settings
// say it is worth telling.
func (r *Runner) announce(ctx context.Context, rec history.Run, body string) {
	if !r.config().Notify.Reports(rec.Failed()) {
		return
	}
	subject := fmt.Sprintf("ArrowLoop: %s finished", rec.Job)
	if rec.Failed() {
		subject = fmt.Sprintf("ArrowLoop: %s FAILED", rec.Job)
	}
	r.tell(ctx, rec.Job, notify.Message{Subject: subject, Body: body, Failed: rec.Failed()})
}

// testMessage is what the "send a test" button sends.
var testMessage = notify.Message{
	Subject: "ArrowLoop: a test message",
	Body:    "If you can read this, ArrowLoop's messages reach you here.",
}

// SendTest sends a test message through one channel, named as the
// configuration names it, and reports what went wrong. It ignores the channel's
// switch and the "when" setting, since a test is how somebody finds out
// whether a channel they are setting up works.
func SendTest(ctx context.Context, n job.Notify, channel string) error {
	ctx, cancel := context.WithTimeout(ctx, notify.SendTimeout)
	defer cancel()
	switch channel {
	case "matrix":
		if n.Matrix == nil {
			return errors.New("matrix needs a homeserver, a room and a token")
		}
		return matrixOf(n.Matrix).Send(ctx, testMessage)
	case "webhook":
		if n.Webhook == "" {
			return errors.New("the webhook has no address")
		}
		return (&notify.Webhook{URL: n.Webhook, Format: n.WebhookFormat}).Send(ctx, testMessage)
	case "smtp":
		if n.SMTP == nil {
			return errors.New("mail needs a server, a sender and a recipient")
		}
		return smtpOf(n.SMTP).Send(ctx, testMessage)
	case "apprise":
		if n.Apprise == nil || n.Apprise.URL == "" {
			return errors.New("apprise has no address")
		}
		return (&notify.Apprise{URL: n.Apprise.URL, Tags: n.Apprise.Tags}).Send(ctx, testMessage)
	case "healthchecks":
		return pingEveryCheck(ctx, n.Healthchecks)
	}
	return fmt.Errorf("there is no channel called %q", channel)
}

// pingEveryCheck sends a success to the shared check and to every job's own,
// once each.
func pingEveryCheck(ctx context.Context, h *job.Healthchecks) error {
	var addresses []string
	if h != nil {
		addresses = append(addresses, h.URL)
		for _, own := range h.Jobs {
			addresses = append(addresses, own)
		}
	}
	seen := map[string]bool{"": true}
	for _, a := range addresses {
		if seen[a] {
			continue
		}
		seen[a] = true
		if err := (notify.Healthchecks{URL: a}).Finish(ctx, true, testMessage.Body); err != nil {
			return err
		}
	}
	if len(seen) == 1 {
		return errors.New("healthchecks has no check address")
	}
	return nil
}
