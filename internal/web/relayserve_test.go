package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/junkerderprovinz/parleyport/kit/phrase"
	"github.com/junkerderprovinz/parleyport/kit/relay"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
)

type relayState struct {
	Mode         string `json:"mode"`
	RelayURL     string `json:"relayUrl"`
	Connected    bool   `json:"connected"`
	Serve        bool   `json:"serve"`
	ServeClients int    `json:"serveClients"`
	CanServe     bool   `json:"canServe"`
}

func (n *node) relay(t *testing.T) relayState {
	t.Helper()
	var v relayState
	n.get(t, "/api/relay/config", &v)
	return v
}

func (n *node) saveRelay(t *testing.T, body string) relayState {
	t.Helper()
	status, out := n.send(t, http.MethodPut, "/api/relay/config", body)
	if status != http.StatusOK {
		t.Fatalf("PUT /api/relay/config %s = %d %s", body, status, out)
	}
	var v relayState
	if err := json.Unmarshal(out, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// makePhrase puts n in a group of its own and returns the group's relay key.
func makePhrase(t *testing.T, n *node) string {
	t.Helper()
	status, body := n.send(t, http.MethodPost, "/api/connect/activate", "{}")
	if status != http.StatusOK {
		t.Fatalf("activate = %d %s", status, body)
	}
	var made struct{ Phrase string }
	if err := json.Unmarshal(body, &made); err != nil {
		t.Fatal(err)
	}
	secret, err := phrase.Decode(made.Phrase)
	if err != nil {
		t.Fatal(err)
	}
	return pairing.Domain.GroupKey(secret)
}

// dialServed opens the relay socket n serves and says hello with key, the way
// a member of the group would.
func dialServed(t *testing.T, n *node, key string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(n.srv.URL, "http")+"/relay/connect", nil)
	if err != nil {
		t.Fatalf("dial the served relay: %v", err)
	}
	t.Cleanup(func() { _ = c.CloseNow() })
	if _, _, err := c.Read(ctx); err != nil {
		t.Fatalf("waiting for the challenge: %v", err)
	}
	hello, err := relay.Encode(relay.TypeHello, relay.Hello{Key: key, Announce: relay.Announce{InstanceID: "member", Name: "member"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	return c
}

// closed reports whether the relay ended c within a few seconds.
func closed(c *websocket.Conn) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			return ctx.Err() == nil
		}
	}
}

func TestTheRelaySocketExistsOnlyWhileServingAGroup(t *testing.T) {
	a := newNode(t, "")
	if status, _ := a.send(t, http.MethodGet, "/relay/connect", ""); status != http.StatusNotFound {
		t.Errorf("the relay socket with the switch off = %d, want 404", status)
	}
	if v := a.saveRelay(t, `{"serve":true}`); !v.Serve || !v.CanServe {
		t.Fatalf("switching the relay on = %+v, want it on", v)
	}
	if status, _ := a.send(t, http.MethodGet, "/relay/connect", ""); status != http.StatusNotFound {
		t.Errorf("the relay socket outside a group = %d, want 404, since no key could pass", status)
	}
	makePhrase(t, a)
	if status, _ := a.send(t, http.MethodGet, "/relay/connect", ""); status == http.StatusNotFound {
		t.Error("the relay socket of an instance serving its group answers 404")
	}
}

func TestTheServedRelayAdmitsOnlyItsOwnGroup(t *testing.T) {
	a := newNode(t, "")
	a.saveRelay(t, `{"serve":true}`)
	key := makePhrase(t, a)

	stranger := dialServed(t, a, pairing.Domain.GroupKey([]byte("fedcba9876543210")))
	if !closed(stranger) {
		t.Error("the served relay kept a connection with another group's key")
	}
	dialServed(t, a, key)
	eventually(t, "the member counted on the served relay", func() bool { return a.relay(t).ServeClients == 1 })
}

func TestTheServedRelayDropsItsConnectionsWhenTheSwitchGoesOffOrTheGroupIsLeft(t *testing.T) {
	a := newNode(t, "")
	a.saveRelay(t, `{"serve":true}`)
	key := makePhrase(t, a)

	member := dialServed(t, a, key)
	eventually(t, "the member on the served relay", func() bool { return a.relay(t).ServeClients == 1 })
	if v := a.saveRelay(t, `{"serve":false}`); v.Serve || v.ServeClients != 0 {
		t.Errorf("switching the relay off = %+v, want it off with nobody counted", v)
	}
	if !closed(member) {
		t.Error("a member stayed on the relay after the switch went off")
	}

	a.saveRelay(t, `{"serve":true}`)
	member = dialServed(t, a, key)
	eventually(t, "the member back on the served relay", func() bool { return a.relay(t).ServeClients == 1 })
	if status, body := a.send(t, http.MethodDelete, "/api/connect", ""); status != http.StatusNoContent {
		t.Fatalf("leave = %d %s", status, body)
	}
	if !closed(member) {
		t.Error("a member stayed on the relay after this instance left the group")
	}
}

func TestTwoInstancesPairThroughTheRelayOneOfThemServes(t *testing.T) {
	a := newNode(t, "")
	a.saveRelay(t, `{"serve":true,"relayUrl":"`+a.srv.URL+`"}`)
	b := newNode(t, a.srv.URL+"/relay/connect")
	_, bID := pair(t, a, b)

	eventually(t, "the other instance's jobs through the served relay", func() bool {
		rows := a.instances(t)
		return len(rows) == 1 && rows[0].ID == bID && rows[0].State == "ok"
	})
	if v := a.relay(t); !v.Connected || v.ServeClients != 2 {
		t.Errorf("the serving instance = %+v, want it connected to itself with both instances counted", v)
	}
	if !b.relay(t).Connected {
		t.Error("the other instance is not connected to the served relay")
	}
}

func TestAPhoneAndTheDesktopAppServeNoRelay(t *testing.T) {
	for _, deployment := range []string{"phone", "desktop"} {
		n := newNodeAs(t, "", deployment)
		if n.relay(t).CanServe {
			t.Errorf("%s says it can serve a relay", deployment)
		}
		if status, body := n.send(t, http.MethodPut, "/api/relay/config", `{"serve":true}`); status != http.StatusBadRequest {
			t.Errorf("switching the relay on at the %s = %d %s, want 400", deployment, status, body)
		}
		if n.relay(t).Serve {
			t.Errorf("the %s stored the switch it refused", deployment)
		}
	}
}

func TestTheServeSwitchIsKeptApartFromTheMode(t *testing.T) {
	a := newNode(t, "")
	a.saveRelay(t, `{"serve":true}`)
	if v := a.saveRelay(t, `{"mode":"project"}`); !v.Serve || v.Mode != "project" {
		t.Errorf("a change of mode = %+v, want the switch left as it was", v)
	}
	if v := a.saveRelay(t, `{"relayUrl":"https://relay.example.org"}`); !v.Serve {
		t.Errorf("a new address = %+v, want the switch left as it was", v)
	}
}
