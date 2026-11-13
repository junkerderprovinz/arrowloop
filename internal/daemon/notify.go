package daemon

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/notify"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/scrub"
)

// NoChannelsEnv names the environment variable that keeps every message
// channel and every Healthchecks check quiet, whatever the configuration
// holds. The phone app sets it, since Android's own notifications report runs
// there. The configuration is read as usual and never rewritten.
const NoChannelsEnv = "ARROWLOOP_NO_CHANNELS"

func channelsOff() bool { return os.Getenv(NoChannelsEnv) != "" }

// source names ArrowLoop where a service shows the sender.
const source = "ArrowLoop"

// Reporting names the channels that are switched on and complete, the ones
// a run is told through. One switched on but still missing something is
// named in incomplete, so the log can say why it does not send.
func Reporting(cfg *job.Config) (ready []notify.Channel, incomplete []string) {
	if channelsOff() {
		return nil, nil
	}
	for _, c := range cfg.Notify.Channels {
		if !c.Enabled {
			continue
		}
		if err := notify.Validate([]notify.Channel{c}); err != nil {
			incomplete = append(incomplete, ChannelName(c))
			continue
		}
		ready = append(ready, c)
	}
	return ready, incomplete
}

// dispatcher builds what sends the messages from the ready channels, or nil
// where there are none.
func dispatcher(cfg *job.Config) (d *notify.Dispatcher, incomplete []string) {
	ready, incomplete := Reporting(cfg)
	if len(ready) == 0 {
		return nil, incomplete
	}
	d, err := notify.NewDispatcher(ready, notify.Options{Source: source})
	if err != nil {
		// Each channel passed on its own, so only two under one id fail here,
		// which Load refuses.
		return nil, incomplete
	}
	return d, incomplete
}

// ChannelName is how a channel is named in the log: by the name it was given,
// else by its id.
func ChannelName(c notify.Channel) string {
	if c.Name != "" {
		return c.Name
	}
	return c.ID
}

// tell sends an event and logs what could not be delivered. The run's own
// context may be cancelled by a stop, and a stopped run is still reported.
func (r *Runner) tell(ctx context.Context, name string, e notify.Event) {
	d := r.dispatcher()
	if d == nil {
		return
	}
	e = r.scrubbed(e)
	for _, res := range d.Send(context.WithoutCancel(ctx), e) {
		if !res.OK() {
			r.log("could not send the notification for %s through %s: %v", name, res.Channel, res.Err)
		}
	}
}

func (r *Runner) dispatcher() *notify.Dispatcher {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.note
}

// scrubbed takes passwords, connection strings and what a hook printed out
// of an event before it leaves the machine, as the bug report does.
func (r *Runner) scrubbed(e notify.Event) notify.Event {
	clean := scrub.Knowing(r.config().Jobs)
	e.Title = scrub.Text(clean(e.Title))
	e.Body = scrub.Text(clean(e.Body))
	return e
}

// checkIn pings the job's Healthchecks check that a run began and returns
// what ends it. The start goes out beside the run rather than ahead of it, so
// a check server that is slow to answer does not delay the copying; the end
// waits for the start, or the check would see them the wrong way round.
func (r *Runner) checkIn(ctx context.Context, name string) func(ok bool, detail string) {
	d := r.dispatcher()
	if d == nil {
		return func(bool, string) {}
	}
	ctx = context.WithoutCancel(ctx)
	ping := func(e notify.Event) {
		e.Key = name
		for _, res := range d.Ping(ctx, r.scrubbed(e)) {
			if !res.OK() {
				r.log("could not tell the check for %s how the run went: %v", name, res.Err)
			}
		}
	}
	started := make(chan struct{})
	go func() {
		defer close(started)
		ping(notify.Event{Kind: "run.started", Ping: notify.PingStart})
	}()
	return func(ok bool, detail string) {
		<-started
		e := notify.Event{Kind: "run.done", Ping: notify.PingSuccess, Body: detail}
		if !ok {
			e.Kind, e.Ping = "run.failed", notify.PingFail
		}
		ping(e)
	}
}

// summary is what a run did, in a few lines.
func summary(rec history.Run, res apply.Result) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d copied, %d moved, %d %s, %d conflicts", rec.Copied, rec.Moved, rec.Trashed, removed(rec), rec.Conflicts)
	if rec.DirsMade+rec.DirsRemoved > 0 {
		fmt.Fprintf(&b, ", %d folders made, %d removed", rec.DirsMade, rec.DirsRemoved)
	}
	fmt.Fprintf(&b, ", %d unchanged, took %s", rec.Unchanged, rec.Finished.Sub(rec.Started).Round(time.Millisecond))
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
	// Last, since scrubbing cuts what a failed command printed off at the end.
	if rec.Err != "" {
		fmt.Fprintf(&b, "\n%s", rec.Err)
	}
	return b.String()
}

// removed is the word for what a run's deletions became, which a job
// without a trash cannot take back.
func removed(rec history.Run) string {
	if rec.NoTrash {
		return "deleted"
	}
	return "trashed"
}

// announce tells whoever is watching about a finished run. Each channel's
// "when" decides whether a success is worth it.
func (r *Runner) announce(ctx context.Context, rec history.Run, body string) {
	e := notify.Event{Kind: "run.done", Severity: notify.SeveritySuccess, Title: fmt.Sprintf("ArrowLoop: %s finished", rec.Job), Body: body, Key: rec.Job}
	if rec.Failed() {
		e.Kind, e.Severity, e.Title = "run.failed", notify.SeverityFailure, fmt.Sprintf("ArrowLoop: %s FAILED", rec.Job)
	}
	r.tell(ctx, rec.Job, e)
}

// testEvent is what the "send a test" button sends.
var testEvent = notify.Event{
	Kind:  "test",
	Title: "ArrowLoop: a test message",
	Body:  "If you can read this, ArrowLoop's messages reach you here.",
}

// CodeOff is the code of a test this engine does not send, as on the phone.
const CodeOff = "off"

// SendTest sends a test message through one channel as the settings page
// shows it, switched on or not and whatever its "when" says, since a test is
// how somebody finds out whether a channel they are setting up works.
// NoChannelsEnv still holds.
func SendTest(ctx context.Context, ch notify.Channel) notify.Result {
	if channelsOff() {
		return notify.Result{Channel: ch.ID, Kind: ch.Kind, Code: CodeOff, Err: errors.New("this engine sends no messages")}
	}
	d, err := notify.NewDispatcher(nil, notify.Options{Source: source})
	if err != nil {
		return notify.Result{Channel: ch.ID, Kind: ch.Kind, Code: notify.CodeInvalid, Err: err}
	}
	return d.Test(ctx, ch, testEvent)
}
