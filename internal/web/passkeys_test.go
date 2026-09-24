package web

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// The ceremony bookkeeping never looks inside the session data.
var testSessionData = webauthn.SessionData{Challenge: "test-challenge"}

// A relying-party id has to be a domain, and most installs are opened on an IP
// address. That case gets an explanation rather than a browser prompt that
// fails with NotAllowedError.
func TestAnIPAddressCannotCarryAPasskey(t *testing.T) {
	for _, host := range []string{
		"192.168.20.63:8422",
		"192.168.20.63",
		"10.0.0.1:80",
		"[fd00::1]:8422",
		// Loopback is still an address.
		"[::1]:8422",
		"127.0.0.1:8422",
		"",
	} {
		r := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
		r.Host = host
		if _, err := rpIDFor(r); err == nil {
			t.Errorf("host %q was accepted as a relying-party id; the browser refuses a bare address, so a button here could only fail", host)
		}
	}
}

// localhost is the exception: browsers treat it as secure and accept it as an
// id, so an SSH tunnel works.
func TestAHostNameCarriesAPasskey(t *testing.T) {
	cases := map[string]string{
		"arrowloop.example.com:8422": "arrowloop.example.com",
		// A domain is case-insensitive.
		"ArrowLoop.Example.COM": "arrowloop.example.com",
		"localhost:8422":        "localhost",
		"tower.local":           "tower.local",
	}
	for host, want := range cases {
		r := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
		r.Host = host
		got, err := rpIDFor(r)
		if err != nil {
			t.Errorf("host %q was refused: %v", host, err)
			continue
		}
		if got != want {
			t.Errorf("host %q gave relying-party id %q, want %q", host, got, want)
		}
	}
}

// A reverse proxy terminates TLS and forwards plain HTTP, so the server's own
// scheme is wrong in exactly the setup where passkeys work.
func TestTheOriginFollowsTheProxysScheme(t *testing.T) {
	plain := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
	plain.Host = "arrowloop.example.com"
	if got := originFor(plain); got != "http://arrowloop.example.com" {
		t.Errorf("origin = %q, want the server's own scheme when nothing says otherwise", got)
	}

	direct := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
	direct.Host = "arrowloop.example.com"
	direct.TLS = &tls.ConnectionState{}
	if got := originFor(direct); got != "https://arrowloop.example.com" {
		t.Errorf("origin = %q over TLS", got)
	}

	proxied := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
	proxied.Host = "arrowloop.example.com"
	proxied.Header.Set("X-Forwarded-Proto", "https")
	if got := originFor(proxied); got != "https://arrowloop.example.com" {
		t.Errorf("origin = %q, want the scheme the browser saw behind the proxy", got)
	}

	chained := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
	chained.Host = "arrowloop.example.com"
	chained.Header.Set("X-Forwarded-Proto", "https, http")
	if got := originFor(chained); got != "https://arrowloop.example.com" {
		t.Errorf("origin = %q, want the first value of the forwarded chain", got)
	}

	nonsense := httptest.NewRequest(http.MethodGet, "/api/passkeys", nil)
	nonsense.Host = "arrowloop.example.com"
	nonsense.Header.Set("X-Forwarded-Proto", "gopher")
	if got := originFor(nonsense); got != "http://arrowloop.example.com" {
		t.Errorf("origin = %q from a scheme that is not one", got)
	}
}

// An answered challenge is spent, or a captured answer could be replayed.
func TestACeremonyHandleWorksOnce(t *testing.T) {
	g := &authGate{}
	id, err := g.beginCeremony(&testSessionData, "arrowloop.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := g.takeCeremony(id); !ok {
		t.Fatal("the handle did not work even once")
	}
	if _, ok := g.takeCeremony(id); ok {
		t.Error("the same ceremony handle was accepted twice")
	}
}

// Login ceremonies start without a session, so the table needs a ceiling that
// does not depend on the caller behaving.
func TestCeremoniesAreBounded(t *testing.T) {
	g := &authGate{}
	for range passkeyCeremonyMax * 3 {
		if _, err := g.beginCeremony(&testSessionData, "arrowloop.example.com"); err != nil {
			t.Fatal(err)
		}
	}
	g.mu.Lock()
	n := len(g.ceremonies)
	g.mu.Unlock()
	if n > passkeyCeremonyMax {
		t.Errorf("%d ceremonies are held, the ceiling is %d; this table is reachable without a session", n, passkeyCeremonyMax)
	}
}

// The login screen asks before anybody is signed in, so it gets counts. The
// list of keys, with names and addresses, is for the owner.
func TestAStrangerSeesCountsButNotTheKeys(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	if _, err := store.AddPasskey(security.Passkey{Name: "Phone", CredentialID: []byte{1}, PublicKey: []byte{1}, RPID: "localhost"}); err != nil {
		t.Fatal(err)
	}

	resp, body := fetch(t, browser(t), srv.URL+"/api/passkeys")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the probe answered a stranger with %s, so the login screen cannot offer the button", resp.Status)
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(body), &probe); err != nil {
		t.Fatal(err)
	}
	if probe["total"] != float64(1) {
		t.Errorf("total = %v, want 1", probe["total"])
	}
	if _, listed := probe["passkeys"]; listed || strings.Contains(body, "Phone") {
		t.Errorf("a stranger was shown the list of keys: %s", body)
	}

	c := browser(t)
	attemptLogin(t, srv, c, uiPassword)
	_, body = fetch(t, c, srv.URL+"/api/passkeys")
	if !strings.Contains(body, "Phone") {
		t.Errorf("the owner does not see the list: %s", body)
	}
}

// httptest serves on 127.0.0.1, which is the IP case.
func TestRegisteringOnAnIPAddressExplainsWhy(t *testing.T) {
	_, srv, store := newSecured(t)
	c := browser(t)
	postAs(t, c, srv.URL+"/api/security/password", map[string]string{"password": uiPassword})
	if store.Get().PasswordHash == "" {
		t.Fatal("no password was set")
	}

	resp, said := postAs(t, c, srv.URL+"/api/passkeys/register/begin", map[string]string{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("registering on an IP answered %s %v", resp.Status, said)
	}
	if msg, _ := said["error"].(string); !strings.Contains(msg, "reverse proxy") {
		t.Errorf("the refusal does not say what to do: %q", msg)
	}
}

// A passkey is an extra way in, never the only one.
func TestPasskeysNeedAPassword(t *testing.T) {
	_, srv, _ := newSecured(t)
	for _, path := range []string{"/api/passkeys/register/begin", "/api/passkeys/login/begin", "/api/passkeys/login/finish"} {
		if resp, _ := postAs(t, browser(t), srv.URL+path, map[string]string{}); resp.StatusCode != http.StatusConflict {
			t.Errorf("%s without a password answered %s", path, resp.Status)
		}
	}
}

// A signature cannot be guessed, but without the shared limit the passkey
// route would be a way around the one that protects the password.
func TestFailedPasskeyLoginsCountTowardsTheLockout(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	c := browser(t)
	for range maxFailedLogins {
		resp, _ := postAs(t, c, srv.URL+"/api/passkeys/login/finish", map[string]string{"ceremonyId": "made-up"})
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("a made-up ceremony answered %s", resp.Status)
		}
	}
	if resp, _ := attemptLogin(t, srv, c, uiPassword); resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("the password login still listened after %d failed passkey logins, answering %s", maxFailedLogins, resp.Status)
	}
}
