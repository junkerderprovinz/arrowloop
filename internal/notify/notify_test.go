package notify

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// TestMatrixPostsWhereItSaysItWill pins the request shape. Matrix is picky about
// the path and the header, and a notification that silently 404s is worth less
// than no notification at all, because it looks configured.
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

	m := &Matrix{Homeserver: srv.URL, Room: "!room:example.org", Token: "secret", Client: srv.Client()}
	if err := m.Send(context.Background(), "ReeveRoll: photos FAILED", "the left side did not mount"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := m.Send(context.Background(), "second", ""); err != nil {
		t.Fatalf("send again: %v", err)
	}

	if auth != "Bearer secret" {
		t.Errorf("the token did not travel: %q", auth)
	}
	if !strings.Contains(paths[0], "/_matrix/client/v3/rooms/") || !strings.Contains(paths[0], "/send/m.room.message/") {
		t.Errorf("wrong endpoint: %s", paths[0])
	}
	// The room id starts with a "!" and usually contains a colon, both of which
	// have to survive as path segments rather than being taken as syntax.
	if !strings.Contains(paths[0], "%21room:example.org") && !strings.Contains(paths[0], "!room:example.org") {
		t.Errorf("the room id was mangled: %s", paths[0])
	}
	if !strings.Contains(bodies[0], "the left side did not mount") {
		t.Errorf("the body did not carry the message: %s", bodies[0])
	}
	if !strings.Contains(bodies[0], "photos FAILED") {
		t.Errorf("the subject did not carry: %s", bodies[0])
	}

	// Matrix deduplicates on the transaction id, so two messages that shared one
	// would show up as a single message, and the one that got swallowed would be
	// the second failure notice.
	if paths[0] == paths[1] {
		t.Errorf("two messages used the same transaction id, so the second would be dropped: %s", paths[0])
	}
}

// TestMatrixReportsWhatTheServerSaid keeps the error useful: the body carries
// Matrix's own code, which is the difference between an expired token and a
// room that does not exist.
func TestMatrixReportsWhatTheServerSaid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"errcode":"M_FORBIDDEN","error":"You are not in that room"}`)
	}))
	defer srv.Close()

	m := &Matrix{Homeserver: srv.URL, Room: "!x:y", Token: "t", Client: srv.Client()}
	err := m.Send(context.Background(), "subject", "body")
	if err == nil {
		t.Fatal("a rejected message was reported as sent")
	}
	if !strings.Contains(err.Error(), "M_FORBIDDEN") {
		t.Errorf("the error hides what the server said: %v", err)
	}
}

// TestMatrixRefusesToBeHalfConfigured turns a missing token into an error rather
// than a request that cannot possibly work.
func TestMatrixRefusesToBeHalfConfigured(t *testing.T) {
	m := &Matrix{Homeserver: "https://example.org", Room: "!x:y"}
	if err := m.Send(context.Background(), "s", "b"); err == nil {
		t.Fatal("a Matrix destination with no token accepted a message")
	}
}

// TestMultiTriesEveryDestination is the reason Multi does not stop at the first
// failure: a Matrix outage must not stop a webhook from firing.
func TestMultiTriesEveryDestination(t *testing.T) {
	var reached bool
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))
	defer good.Close()

	m := Multi{
		&Matrix{Homeserver: "", Room: "", Token: ""}, // cannot possibly work
		&Webhook{URL: good.URL, Client: good.Client()},
	}
	err := m.Send(context.Background(), "subject", "body")
	if !reached {
		t.Fatal("the webhook was never tried because the Matrix destination failed first")
	}
	if err == nil {
		t.Fatal("the failing destination was not reported")
	}
	if !strings.Contains(err.Error(), "matrix") {
		t.Errorf("the error does not say which destination failed: %v", err)
	}
}

// TestWebhookReportsARefusal keeps a rejected webhook from looking delivered.
func TestWebhookReportsARefusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	w := &Webhook{URL: srv.URL, Client: srv.Client()}
	if err := w.Send(context.Background(), "s", "b"); err == nil {
		t.Fatal("a 500 was treated as a delivered message")
	} else if !strings.Contains(err.Error(), "500") {
		t.Errorf("the status is missing from the error: %v", err)
	}
}
