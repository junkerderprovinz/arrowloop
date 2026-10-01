package web

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	if _, err := store.AddPasskey(security.Passkey{Name: "Phone", CredentialID: []byte{1}, PublicKey: []byte{1}, RPID: "localhost"}, ""); err != nil {
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

// beginRegistration starts a registration as a browser on localhost would,
// the one address an httptest server can carry a passkey on.
func beginRegistration(t *testing.T, c *http.Client, srv *httptest.Server, body map[string]string) int {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/passkeys/register/begin", strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	// The jar files cookies under the Host header, so the session is carried
	// over by hand.
	for _, cookie := range c.Jar.Cookies(req.URL) {
		req.AddCookie(cookie)
	}
	req.Host = "localhost" + srv.URL[strings.LastIndex(srv.URL, ":"):]
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// A passkey signs in on its own, so adding one asks for everything a login
// asks for. A session somebody walked away from is not enough.
func TestRegisteringAPasskeyNeedsThePasswordAndTheCode(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	c := browser(t)
	attemptLogin(t, srv, c, uiPassword)

	if code := beginRegistration(t, c, srv, map[string]string{}); code != http.StatusForbidden {
		t.Errorf("a registration without the password answered %d", code)
	}
	if code := beginRegistration(t, c, srv, map[string]string{"current": "not it"}); code != http.StatusForbidden {
		t.Errorf("a registration with a wrong password answered %d", code)
	}
	if code := beginRegistration(t, c, srv, map[string]string{"current": uiPassword}); code != http.StatusOK {
		t.Fatalf("a registration with the password answered %d", code)
	}

	storeTOTP(t, store, nil)
	if code := beginRegistration(t, c, srv, map[string]string{"current": uiPassword}); code != http.StatusForbidden {
		t.Errorf("with a second factor on, a registration without the code answered %d", code)
	}
	if code := beginRegistration(t, c, srv, map[string]string{"current": uiPassword, "code": codeAt(t, time.Now())}); code != http.StatusOK {
		t.Errorf("a registration with the password and the code answered %d", code)
	}
}

// Changing a password that may have leaked has to evict everybody who got in
// with it, including through a key they registered meanwhile.
func TestChangingOrRemovingThePasswordRemovesThePasskeys(t *testing.T) {
	for _, route := range []string{"/api/security/password", "/api/security/password/remove"} {
		_, srv, store := newSecured(t)
		storePassword(t, store)
		if _, err := store.AddPasskey(security.Passkey{Name: "Planted", CredentialID: []byte{1}, PublicKey: []byte{1}, RPID: "localhost"}, ""); err != nil {
			t.Fatal(err)
		}
		c := browser(t)
		attemptLogin(t, srv, c, uiPassword)

		resp, said := postAs(t, c, srv.URL+route, map[string]string{"current": uiPassword, "password": uiPassword + " and more"})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s answered %s: %v", route, resp.Status, said)
		}
		if n := len(store.Get().Passkeys); n != 0 {
			t.Errorf("%s left %d passkeys behind", route, n)
		}
	}
}

// A password set through the environment changes where the interface cannot
// see it, and a key registered under the old one must not outlive it.
func TestChangingThePasswordInTheEnvironmentRemovesThePasskeys(t *testing.T) {
	config := filepath.Join(t.TempDir(), "arrowloop.json")
	start := func(hash string) *security.Store {
		t.Helper()
		t.Setenv(PasswordHashEnv, hash)
		store, err := security.Open(config)
		if err != nil {
			t.Fatal(err)
		}
		srv := httptest.NewServer((&Server{Security: store}).Handler())
		t.Cleanup(srv.Close)
		resp, err := http.Get(srv.URL + "/api/passkeys")
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return store
	}

	first := testHash(t, uiPassword)
	store := start(first)
	if _, err := store.AddPasskey(security.Passkey{Name: "Phone", CredentialID: []byte{1}, PublicKey: []byte{1}, RPID: "localhost"}, ""); err != nil {
		t.Fatal(err)
	}

	if n := len(start(first).Get().Passkeys); n != 1 {
		t.Fatalf("a restart with the same password left %d passkeys, want 1", n)
	}
	if n := len(start(testHash(t, uiPassword+" and more")).Get().Passkeys); n != 0 {
		t.Errorf("a new password in the environment left %d passkeys behind", n)
	}
}

// A file written before the keys carried their password's fingerprint keeps
// its keys.
func TestPasskeysFromAnOlderFileAreKept(t *testing.T) {
	_, srv, store := newSecured(t)
	storePassword(t, store)
	if err := store.Update(func(st *security.State) error {
		st.Passkeys = []security.Passkey{{ID: "old", Name: "Phone", CredentialID: []byte{1}, PublicKey: []byte{1}, RPID: "localhost"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(srv.URL + "/api/passkeys")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if n := len(store.Get().Passkeys); n != 1 {
		t.Errorf("an older file lost its passkeys: %d left", n)
	}
}
