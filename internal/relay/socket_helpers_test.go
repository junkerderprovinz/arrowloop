package relay

import (
	"context"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// wsTimeout bounds every step of a test against the relay, so a protocol mistake
// fails the run instead of hanging it.
const wsTimeout = 10 * time.Second

// dialInstance opens a real WebSocket to the relay and completes the hello
// handshake, returning the connection an instance would then keep open.
func dialInstance(t *testing.T, url, key, id string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wsTimeout)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial %s as %s: %v", url, id, err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	readFrame(t, c, TypeChallenge)
	writeFrame(t, c, TypeHello, Hello{
		Key:      key,
		Announce: Announce{InstanceID: id, Name: id, Deployment: "container"},
	})
	return c
}

func writeFrame(t *testing.T, c *websocket.Conn, typ string, data any) {
	t.Helper()
	frame, err := Encode(typ, data)
	if err != nil {
		t.Fatalf("encode %s: %v", typ, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), wsTimeout)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, frame); err != nil {
		t.Fatalf("write %s: %v", typ, err)
	}
}

func readFrame(t *testing.T, c *websocket.Conn, want string) Envelope {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wsTimeout)
	defer cancel()
	_, frame, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("waiting for a %s frame: %v", want, err)
	}
	env, err := Decode(frame)
	if err != nil {
		t.Fatalf("waiting for a %s frame: %s is not an envelope (%v)", want, frame, err)
	}
	if env.Type != want {
		t.Fatalf("got a %q frame, want %q", env.Type, want)
	}
	return env
}
