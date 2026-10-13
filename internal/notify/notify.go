// Package notify sends a line about a run to wherever the user is watching:
// a Matrix room, a webhook in one of several services' formats, mail, an
// Apprise API server, and Healthchecks.io pings. Every send is bounded in
// time, and a failure is only ever reported, never allowed to touch a run.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/scrub"
)

// SendTimeout bounds one message to one destination.
const SendTimeout = 15 * time.Second

// Message is one thing worth telling.
type Message struct {
	Subject string
	Body    string
	// Failed marks bad news, which the services that know priorities show
	// louder.
	Failed bool
}

// Notifier sends one message.
type Notifier interface {
	Send(ctx context.Context, m Message) error
	// Describe names the destination without anything secret in it, since it
	// goes into the log.
	Describe() string
}

// Multi sends to every destination at once and reports all the failures
// rather than the first. A Matrix outage must not stop a webhook from firing,
// nor a slow mail server hold up the rest.
type Multi []Notifier

// Send delivers to all destinations.
func (m Multi) Send(ctx context.Context, msg Message) error {
	errs := make([]error, len(m))
	var wg sync.WaitGroup
	for i, n := range m {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := n.Send(ctx, msg); err != nil {
				errs[i] = fmt.Errorf("%s: %w", n.Describe(), Redact(err))
			}
		}()
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("could not notify: %w", err)
	}
	return nil
}

// Describe names the destinations.
func (m Multi) Describe() string {
	if len(m) == 0 {
		return "nowhere"
	}
	parts := make([]string, 0, len(m))
	for _, n := range m {
		parts = append(parts, n.Describe())
	}
	return strings.Join(parts, " and ")
}

// Redact drops the address from a failed request's error, because a webhook,
// an Apprise key and a Healthchecks check carry their secret in the address.
// The cause, such as a timeout or a refused connection, stays.
func Redact(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return fmt.Errorf("%s: %w", ue.Op, ue.Err)
	}
	return err
}

// scrubbed takes passwords and what a hook printed out of a message before it
// leaves the machine, as the bug report does.
func scrubbed(m Message) Message {
	m.Subject = scrub.Text(m.Subject)
	m.Body = scrub.Text(m.Body)
	return m
}

// text is the subject and the body as one block, for the services that take
// a single text.
func (m Message) text() string {
	if m.Body == "" {
		return m.Subject
	}
	return m.Subject + "\n" + m.Body
}

// hostOf names an address by its host alone, which is safe to log.
func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "an address that does not parse"
	}
	return u.Host
}

// Refused is a service's answer that was not a success. Said is the start of
// what it wrote back, which is where a service says why.
type Refused struct {
	Code   int
	Status string
	Said   string
}

func (r *Refused) Error() string {
	if r.Said == "" {
		return r.Status
	}
	return r.Status + ": " + r.Said
}

var client = &http.Client{Timeout: SendTimeout}

// do sends a request bounded by SendTimeout and reports a refusal with the
// status and, where the service explains itself, the start of what it said.
func do(ctx context.Context, method, endpoint string, body io.Reader, header map[string]string) error {
	ctx, cancel := context.WithTimeout(ctx, SendTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return Redact(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return Redact(err)
	}
	defer resp.Body.Close()
	said, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &Refused{Code: resp.StatusCode, Status: resp.Status, Said: strings.TrimSpace(string(said))}
	}
	return nil
}

func postJSON(ctx context.Context, endpoint string, payload any, header map[string]string) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	h := map[string]string{"Content-Type": "application/json"}
	for k, v := range header {
		h[k] = v
	}
	return do(ctx, http.MethodPost, endpoint, bytes.NewReader(body), h)
}

// Matrix posts into a room as the account the token belongs to.
type Matrix struct {
	Homeserver string
	Room       string
	Token      string

	txn atomic.Uint64
}

// Describe names the room.
func (m *Matrix) Describe() string { return "matrix room " + m.Room }

// Send posts a message. Matrix deduplicates retries by transaction id, so the
// id adds a counter to the clock to stay unique per message. The token goes
// in a header, never into the address.
func (m *Matrix) Send(ctx context.Context, msg Message) error {
	if m.Homeserver == "" || m.Room == "" || m.Token == "" {
		return errors.New("matrix needs a homeserver, a room and a token")
	}
	txn := fmt.Sprintf("arrowloop-%d-%d", time.Now().UnixNano(), m.txn.Add(1))
	endpoint := fmt.Sprintf("%s/_matrix/client/v3/rooms/%s/send/m.room.message/%s",
		strings.TrimRight(m.Homeserver, "/"), url.PathEscape(m.Room), url.PathEscape(txn))
	payload, err := json.Marshal(map[string]string{"msgtype": "m.text", "body": scrubbed(msg).text()})
	if err != nil {
		return err
	}
	// The answer carries Matrix's error code, which tells an expired token
	// from a missing room.
	return do(ctx, http.MethodPut, endpoint, bytes.NewReader(payload), map[string]string{
		"Content-Type":  "application/json",
		"Authorization": "Bearer " + m.Token,
	})
}

// Webhook posts to an address in the shape the service behind it expects.
type Webhook struct {
	URL string
	// Format is "generic" (or empty), "discord", "slack", "gotify" or "ntfy".
	Format string
}

// Describe names the service and its host; the rest of the address is the
// webhook's key.
func (w *Webhook) Describe() string {
	format := w.Format
	if format == "" || format == "generic" {
		format = "webhook"
	}
	return format + " at " + hostOf(w.URL)
}

// Send posts the message.
func (w *Webhook) Send(ctx context.Context, msg Message) error {
	msg = scrubbed(msg)
	switch w.Format {
	case "discord":
		return postJSON(ctx, w.URL, map[string]string{"content": msg.text()}, nil)
	case "slack":
		return postJSON(ctx, w.URL, map[string]string{"text": msg.text()}, nil)
	case "gotify":
		priority := 5
		if msg.Failed {
			priority = 8
		}
		return postJSON(ctx, w.URL, map[string]any{"title": msg.Subject, "message": msg.Body, "priority": priority}, nil)
	case "ntfy":
		header := map[string]string{"Title": msg.Subject}
		if msg.Failed {
			header["Priority"] = "high"
			header["Tags"] = "warning"
		}
		return do(ctx, http.MethodPost, w.URL, strings.NewReader(msg.Body), header)
	default:
		return postJSON(ctx, w.URL, map[string]any{"subject": msg.Subject, "body": msg.Body, "ok": !msg.Failed}, nil)
	}
}

// Apprise posts to the notify endpoint of a user-run Apprise API server
// (github.com/caronc/apprise-api), which passes the message on to whatever
// services that key is set up for.
type Apprise struct {
	URL string
	// Tags limits a shared key to some of its targets, comma separated.
	Tags string
}

// Describe names the server; the key is in the path.
func (a *Apprise) Describe() string { return "apprise at " + hostOf(a.URL) }

// Send posts the message with Apprise's type for the outcome.
func (a *Apprise) Send(ctx context.Context, msg Message) error {
	msg = scrubbed(msg)
	kind := "success"
	if msg.Failed {
		kind = "failure"
	}
	payload := map[string]string{"title": msg.Subject, "body": msg.Body, "type": kind}
	if a.Tags != "" {
		payload["tag"] = a.Tags
	}
	return postJSON(ctx, a.URL, payload, nil)
}

// Healthchecks pings a Healthchecks.io check, or any server that speaks its
// protocol: a ping at the start lets the check time the run and catch one
// that hangs, and the outcome ends it.
type Healthchecks struct {
	URL string
}

// Describe names the server; the check's id is its key.
func (h Healthchecks) Describe() string { return "healthchecks at " + hostOf(h.URL) }

// Start says a run began.
func (h Healthchecks) Start(ctx context.Context) error {
	return do(ctx, http.MethodGet, strings.TrimRight(h.URL, "/")+"/start", nil, nil)
}

// Finish says how the run ended. The detail goes into the check's event log.
func (h Healthchecks) Finish(ctx context.Context, ok bool, detail string) error {
	endpoint := strings.TrimRight(h.URL, "/")
	if !ok {
		endpoint += "/fail"
	}
	if detail == "" {
		return do(ctx, http.MethodGet, endpoint, nil, nil)
	}
	return do(ctx, http.MethodPost, endpoint, strings.NewReader(scrubbed(Message{Body: detail}).Body), nil)
}
