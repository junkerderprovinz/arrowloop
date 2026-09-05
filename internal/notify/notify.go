// Package notify sends a line about a run to wherever the user is watching.
//
// The point is not to be chatty. A tool that announces every successful sync
// teaches its user to ignore it, and then the one message that mattered gets
// ignored with the rest. So the default is failures only, and the message says
// which job, what went wrong, and nothing else.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// Notifier sends one message.
type Notifier interface {
	Send(ctx context.Context, subject, body string) error
	Describe() string
}

// Multi sends to every destination and reports all the failures rather than the
// first. A Matrix outage must not stop a webhook from firing.
type Multi []Notifier

// Send delivers to all destinations.
func (m Multi) Send(ctx context.Context, subject, body string) error {
	var failures []string
	for _, n := range m {
		if err := n.Send(ctx, subject, body); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", n.Describe(), err))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("could not notify: %s", strings.Join(failures, "; "))
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

// Matrix posts into a room as the account the token belongs to.
type Matrix struct {
	Homeserver string
	Room       string
	Token      string
	Client     *http.Client

	txn atomic.Uint64
}

// Describe names the room.
func (m *Matrix) Describe() string { return "matrix room " + m.Room }

// Send posts a message.
//
// The transaction id has to be unique per message, because Matrix uses it to
// deduplicate retries. It is built from the clock plus a counter rather than
// the clock alone: two messages in the same nanosecond are unlikely and a
// deduplicated failure notice is exactly the message nobody would miss until it
// mattered.
func (m *Matrix) Send(ctx context.Context, subject, body string) error {
	if m.Homeserver == "" || m.Room == "" || m.Token == "" {
		return fmt.Errorf("matrix needs a homeserver, a room and a token")
	}
	txn := fmt.Sprintf("reeveroll-%d-%d", time.Now().UnixNano(), m.txn.Add(1))
	endpoint := fmt.Sprintf("%s/_matrix/client/v3/rooms/%s/send/m.room.message/%s",
		strings.TrimRight(m.Homeserver, "/"), url.PathEscape(m.Room), url.PathEscape(txn))

	text := subject
	if body != "" {
		text += "\n" + body
	}
	payload, err := json.Marshal(map[string]string{"msgtype": "m.text", "body": text})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+m.Token)

	resp, err := m.client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// The body carries Matrix's own error code, which is the difference
		// between "the token expired" and "that room does not exist".
		var buf bytes.Buffer
		buf.ReadFrom(resp.Body)
		return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(buf.String()))
	}
	return nil
}

func (m *Matrix) client() *http.Client {
	if m.Client != nil {
		return m.Client
	}
	return &http.Client{Timeout: 20 * time.Second}
}

// Webhook posts a small JSON document anywhere that will take one.
type Webhook struct {
	URL    string
	Client *http.Client
}

// Describe names the endpoint.
func (w *Webhook) Describe() string { return "webhook " + w.URL }

// Send posts the message as JSON.
func (w *Webhook) Send(ctx context.Context, subject, body string) error {
	payload, err := json.Marshal(map[string]string{"subject": subject, "body": body})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := w.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s", resp.Status)
	}
	return nil
}
