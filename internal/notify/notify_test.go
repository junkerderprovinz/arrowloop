package notify

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

var failed = Message{Subject: "ArrowLoop: photos failed", Body: "the left side did not mount", Failed: true}

// heard is what a test server was sent.
type heard struct {
	mu       sync.Mutex
	method   string
	path     string
	header   http.Header
	body     string
	requests int
}

func (h *heard) last() (string, string, http.Header, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.method, h.path, h.header, h.body
}

func (h *heard) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.requests
}

func listener(t *testing.T, status int) (*httptest.Server, *heard) {
	t.Helper()
	h := &heard{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		h.mu.Lock()
		h.method, h.path, h.header, h.body = r.Method, r.URL.Path, r.Header.Clone(), string(b)
		h.requests++
		h.mu.Unlock()
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	return srv, h
}

func decoded(t *testing.T, body string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("not JSON: %q", body)
	}
	return out
}

func TestMatrixPostsWhereItSaysItWill(t *testing.T) {
	var mu sync.Mutex
	var paths, bodies []string
	var auth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		paths = append(paths, r.URL.Path)
		auth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	m := &Matrix{Homeserver: srv.URL, Room: "!room:example.org", Token: "secret"}
	if err := m.Send(context.Background(), failed); err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := m.Send(context.Background(), Message{Subject: "second"}); err != nil {
		t.Fatalf("send again: %v", err)
	}

	if auth != "Bearer secret" {
		t.Errorf("the token did not travel: %q", auth)
	}
	if !strings.Contains(paths[0], "/_matrix/client/v3/rooms/") || !strings.Contains(paths[0], "/send/m.room.message/") {
		t.Errorf("wrong endpoint: %s", paths[0])
	}
	// The "!" and the colon of a room id have to survive as a path segment.
	if !strings.Contains(paths[0], "%21room:example.org") && !strings.Contains(paths[0], "!room:example.org") {
		t.Errorf("the room id was mangled: %s", paths[0])
	}
	if !strings.Contains(bodies[0], "the left side did not mount") || !strings.Contains(bodies[0], "photos failed") {
		t.Errorf("the message did not carry: %s", bodies[0])
	}
	// Matrix deduplicates on the transaction id.
	if paths[0] == paths[1] {
		t.Errorf("two messages used the same transaction id, so the second would be dropped: %s", paths[0])
	}
}

func TestMatrixReportsWhatTheServerSaid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"errcode":"M_FORBIDDEN","error":"You are not in that room"}`)
	}))
	defer srv.Close()

	m := &Matrix{Homeserver: srv.URL, Room: "!x:y", Token: "t"}
	err := m.Send(context.Background(), failed)
	if err == nil {
		t.Fatal("a rejected message was reported as sent")
	}
	if !strings.Contains(err.Error(), "M_FORBIDDEN") {
		t.Errorf("the error hides what the server said: %v", err)
	}
}

func TestMatrixRefusesToBeHalfConfigured(t *testing.T) {
	m := &Matrix{Homeserver: "https://example.org", Room: "!x:y"}
	if err := m.Send(context.Background(), failed); err == nil {
		t.Fatal("a Matrix destination with no token accepted a message")
	}
}

func TestEveryWebhookFormatSpeaksItsServicesLanguage(t *testing.T) {
	for _, tc := range []struct {
		format string
		check  func(t *testing.T, header http.Header, body string)
	}{
		{"", func(t *testing.T, _ http.Header, body string) {
			got := decoded(t, body)
			if got["subject"] != failed.Subject || got["body"] != failed.Body || got["ok"] != false {
				t.Errorf("generic body = %v", got)
			}
		}},
		{"discord", func(t *testing.T, _ http.Header, body string) {
			if got := decoded(t, body)["content"]; got != failed.Subject+"\n"+failed.Body {
				t.Errorf("discord content = %v", got)
			}
		}},
		{"slack", func(t *testing.T, _ http.Header, body string) {
			if got := decoded(t, body)["text"]; got != failed.Subject+"\n"+failed.Body {
				t.Errorf("slack text = %v", got)
			}
		}},
		{"gotify", func(t *testing.T, _ http.Header, body string) {
			got := decoded(t, body)
			if got["title"] != failed.Subject || got["message"] != failed.Body || got["priority"] != float64(8) {
				t.Errorf("gotify body = %v", got)
			}
		}},
		{"ntfy", func(t *testing.T, header http.Header, body string) {
			if body != failed.Body || header.Get("Title") != failed.Subject || header.Get("Priority") != "high" {
				t.Errorf("ntfy got body %q, title %q, priority %q", body, header.Get("Title"), header.Get("Priority"))
			}
		}},
	} {
		t.Run("format "+tc.format, func(t *testing.T) {
			srv, h := listener(t, http.StatusOK)
			if err := (&Webhook{URL: srv.URL, Format: tc.format}).Send(context.Background(), failed); err != nil {
				t.Fatalf("send: %v", err)
			}
			method, _, header, body := h.last()
			if method != http.MethodPost {
				t.Errorf("method %s", method)
			}
			tc.check(t, header, body)
		})
	}
}

func TestAQuietMessageIsNotPushedAsUrgent(t *testing.T) {
	srv, h := listener(t, http.StatusOK)
	ok := Message{Subject: "ArrowLoop: photos finished", Body: "3 copied"}
	if err := (&Webhook{URL: srv.URL, Format: "ntfy"}).Send(context.Background(), ok); err != nil {
		t.Fatal(err)
	}
	if _, _, header, _ := h.last(); header.Get("Priority") != "" {
		t.Errorf("a finished run was sent with priority %q", header.Get("Priority"))
	}
	if err := (&Webhook{URL: srv.URL, Format: "gotify"}).Send(context.Background(), ok); err != nil {
		t.Fatal(err)
	}
	if _, _, _, body := h.last(); decoded(t, body)["priority"] != float64(5) {
		t.Errorf("gotify priority for a finished run: %v", decoded(t, body)["priority"])
	}
}

func TestWebhookReportsARefusal(t *testing.T) {
	srv, _ := listener(t, http.StatusInternalServerError)
	err := (&Webhook{URL: srv.URL}).Send(context.Background(), failed)
	if err == nil {
		t.Fatal("a 500 was treated as a delivered message")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("the status is missing from the error: %v", err)
	}
}

func TestAppriseGetsTitleBodyTypeAndTags(t *testing.T) {
	srv, h := listener(t, http.StatusOK)
	a := &Apprise{URL: srv.URL + "/notify/key", Tags: "backups,homelab"}
	if err := a.Send(context.Background(), failed); err != nil {
		t.Fatalf("send: %v", err)
	}
	_, path, _, body := h.last()
	got := decoded(t, body)
	if path != "/notify/key" || got["title"] != failed.Subject || got["body"] != failed.Body || got["type"] != "failure" || got["tag"] != "backups,homelab" {
		t.Errorf("apprise got %s %v", path, got)
	}

	if err := (&Apprise{URL: srv.URL}).Send(context.Background(), Message{Subject: "s"}); err != nil {
		t.Fatal(err)
	}
	_, _, _, body = h.last()
	got = decoded(t, body)
	if got["type"] != "success" {
		t.Errorf("a finished run is typed %v", got["type"])
	}
	if _, ok := got["tag"]; ok {
		t.Error("an empty tag filter was sent, which Apprise reads as a filter matching nothing")
	}
}

func TestHealthchecksPingsTheStartAndTheOutcome(t *testing.T) {
	srv, h := listener(t, http.StatusOK)
	check := Healthchecks{URL: srv.URL + "/uuid/"}

	if err := check.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, path, _, _ := h.last(); path != "/uuid/start" {
		t.Errorf("start pinged %s", path)
	}
	if err := check.Finish(context.Background(), false, "the target refused"); err != nil {
		t.Fatal(err)
	}
	if method, path, _, body := h.last(); path != "/uuid/fail" || method != http.MethodPost || body != "the target refused" {
		t.Errorf("a failure pinged %s %s with %q", method, path, body)
	}
	if err := check.Finish(context.Background(), true, ""); err != nil {
		t.Fatal(err)
	}
	if method, path, _, _ := h.last(); path != "/uuid" || method != http.MethodGet {
		t.Errorf("a success pinged %s %s", method, path)
	}
}

func TestMultiTriesEveryDestination(t *testing.T) {
	srv, h := listener(t, http.StatusOK)
	m := Multi{
		&Matrix{}, // cannot possibly work
		&Webhook{URL: srv.URL},
	}
	err := m.Send(context.Background(), failed)
	if h.count() == 0 {
		t.Fatal("the webhook was never tried because the Matrix destination failed first")
	}
	if err == nil {
		t.Fatal("the failing destination was not reported")
	}
	if !strings.Contains(err.Error(), "matrix") {
		t.Errorf("the error does not say which destination failed: %v", err)
	}
}

func TestASlowDestinationDoesNotHoldTheOthersUp(t *testing.T) {
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer slow.Close()
	defer close(release)
	fast, h := listener(t, http.StatusOK)

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Multi{&Webhook{URL: slow.URL}, &Webhook{URL: fast.URL}}.Send(ctx, failed) }()

	select {
	case err := <-done:
		if err == nil {
			t.Error("a destination that never answered counted as delivered")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the send outlived its deadline")
	}
	if h.count() != 1 {
		t.Error("the fast destination waited for the slow one and never got the message")
	}
}

// A webhook's address and an Apprise key are secrets, and an error carries
// the request's address by default.
func TestASecretAddressNeverReachesAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead := srv.URL
	srv.Close()

	for _, n := range []Notifier{
		&Webhook{URL: dead + "/hooks/SECRETHOOK"},
		&Apprise{URL: dead + "/notify/SECRETKEY"},
		&Matrix{Homeserver: dead, Room: "!r:x", Token: "SECRETTOKEN"},
	} {
		err := Multi{n}.Send(context.Background(), failed)
		if err == nil {
			t.Fatalf("%s: a closed server took the message", n.Describe())
		}
		for _, secret := range []string{"SECRETHOOK", "SECRETKEY", "SECRETTOKEN"} {
			if strings.Contains(err.Error(), secret) || strings.Contains(n.Describe(), secret) {
				t.Errorf("%s leaks %s: %v", n.Describe(), secret, err)
			}
		}
		if !strings.Contains(err.Error(), "refused") && !strings.Contains(err.Error(), "connect") {
			t.Errorf("the cause got lost with the address: %v", err)
		}
	}

	ping := Healthchecks{URL: dead + "/SECRETUUID"}
	if err := ping.Start(context.Background()); err == nil || strings.Contains(err.Error(), "SECRETUUID") {
		t.Errorf("a ping error leaks the check: %v", err)
	}
}

func TestRedactKeepsTheCauseAndDropsTheAddress(t *testing.T) {
	err := Redact(&url.Error{Op: "Post", URL: "https://discord.com/api/webhooks/1/TOKEN", Err: errors.New("dial tcp: connection refused")})
	if strings.Contains(err.Error(), "TOKEN") || !strings.Contains(err.Error(), "connection refused") {
		t.Errorf("redacted to %q", err)
	}
	if Redact(errors.New("boom")).Error() != "boom" {
		t.Error("a plain error was changed")
	}
	if Redact(nil) != nil {
		t.Error("no error became one")
	}
}

func TestAPasswordInAMessageIsNotSent(t *testing.T) {
	srv, h := listener(t, http.StatusOK)
	m := Message{Subject: "ArrowLoop: sftp://bob:hunter2@nas.local failed", Body: "could not reach ftp://alice:s3cret@host/path"}
	if err := (&Webhook{URL: srv.URL}).Send(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	_, _, _, body := h.last()
	for _, secret := range []string{"hunter2", "s3cret"} {
		if strings.Contains(body, secret) {
			t.Errorf("the message carries %s: %s", secret, body)
		}
	}
	if !strings.Contains(body, "nas.local") {
		t.Errorf("the place went with the password: %s", body)
	}
}

func TestAConnectionStringInAMessageLosesItsParameters(t *testing.T) {
	srv, h := listener(t, http.StatusOK)
	m := Message{Subject: "ArrowLoop: photos FAILED", Body: "open nas,user=bob,pass=hunter2:share: refused\n" +
		`list :s3,access_key_id=AK,secret_access_key="s3:cret":bucket failed`}
	if err := (&Webhook{URL: srv.URL}).Send(context.Background(), m); err != nil {
		t.Fatal(err)
	}
	_, _, _, body := h.last()
	for _, secret := range []string{"hunter2", "user=bob", "s3:cret", "AK"} {
		if strings.Contains(body, secret) {
			t.Errorf("the message carries %s: %s", secret, body)
		}
	}
	for _, kept := range []string{"nas:share: refused", ":s3:bucket failed"} {
		if !strings.Contains(body, kept) {
			t.Errorf("the message lost %q: %s", kept, body)
		}
	}
}
