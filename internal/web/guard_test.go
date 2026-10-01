package web_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

func newGuardedServer(t *testing.T) *httptest.Server {
	t.Helper()
	h := newHarness(t)
	s := &web.Server{History: h.history, Runner: h.runner}
	srv := httptest.NewServer(s.Guard(s.Handler()))
	t.Cleanup(srv.Close)
	return srv
}

func send(t *testing.T, srv *httptest.Server, method, path string, header map[string]string, host string) int {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	if host != "" {
		req.Host = host
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// A page on any site can send a POST to 127.0.0.1 without asking first, and
// the handlers read a JSON body whatever its content type says.
func TestAnotherSitesPageCannotChangeAnything(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)

	refused := []map[string]string{
		{"Sec-Fetch-Site": "cross-site"},
		// Another web interface on the same machine, on another port.
		{"Sec-Fetch-Site": "same-site"},
		{"Origin": "https://attacker.example"},
	}
	for _, header := range refused {
		if code := send(t, srv, http.MethodPost, "/api/jobs/nope/stop", header, ""); code != http.StatusForbidden {
			t.Errorf("a POST with %v answered %d", header, code)
		}
	}

	allowed := []map[string]string{
		{"Sec-Fetch-Site": "same-origin"},
		// The phone app and scripts send neither header.
		{},
	}
	for _, header := range allowed {
		if code := send(t, srv, http.MethodPost, "/api/jobs/nope/stop", header, ""); code != http.StatusNotFound {
			t.Errorf("a POST with %v answered %d, want the route's own 404", header, code)
		}
	}
}

// A page whose host name the attacker re-points at 127.0.0.1 is same-origin to
// the browser, so with no password only names nobody outside can own work.
func TestWithoutAPasswordOnlyLocalNamesAreServed(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)

	for _, host := range []string{"attacker.example:8422", "arrowloop.example.com"} {
		if code := send(t, srv, http.MethodGet, "/api/jobs", nil, host); code != http.StatusMisdirectedRequest {
			t.Errorf("host %s answered %d", host, code)
		}
	}
	for _, host := range []string{
		"127.0.0.1:8422", "[::1]:8422", "192.168.1.5:8422", "localhost:8422",
		"tower:8422", "nas.local", "arrowloop.home.arpa", "box.lan", "wails.localhost",
		"nas.fritz.box", "tower.localdomain", "nas.home",
	} {
		if code := send(t, srv, http.MethodGet, "/api/jobs", nil, host); code != http.StatusOK {
			t.Errorf("host %s answered %d", host, code)
		}
	}
}

// A reverse proxy with a public name can be let in without a password, by
// whoever runs it.
func TestNamesListedInTheEnvironmentAreServed(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	t.Setenv(web.HostsEnv, "Sync.Example.com, .mine.example")
	srv := newGuardedServer(t)

	for _, host := range []string{"sync.example.com", "sync.example.com:443", "nas.mine.example"} {
		if code := send(t, srv, http.MethodGet, "/api/jobs", nil, host); code != http.StatusOK {
			t.Errorf("listed host %s answered %d", host, code)
		}
	}
	for _, host := range []string{"example.com", "other.example.com", "mine.example.attacker.example"} {
		if code := send(t, srv, http.MethodGet, "/api/jobs", nil, host); code != http.StatusMisdirectedRequest {
			t.Errorf("unlisted host %s answered %d", host, code)
		}
	}
}

func TestARefusedNameIsToldHowToGetIn(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/jobs", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "arrowloop.example.com"
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	for _, want := range []string{"arrowloop.example.com", web.HostsEnv} {
		if !strings.Contains(string(body), want) {
			t.Errorf("the refusal %s does not mention %s", body, want)
		}
	}
}

// With a password the cookie belongs to the name it was set on, so a
// re-pointed name gets nothing, and a reverse proxy's name has to work.
func TestWithAPasswordAnyNameIsServed(t *testing.T) {
	hash, err := web.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(web.PasswordHashEnv, hash)
	srv := newGuardedServer(t)

	if code := send(t, srv, http.MethodGet, "/api/session", nil, "arrowloop.example.com"); code != http.StatusOK {
		t.Errorf("a proxy's host name answered %d", code)
	}
}

// Loopback on a phone is open to every app on it, so the engine the app starts
// answers only requests that carry the token the app handed it.
func TestWithAnAppTokenOnlyTheAppGetsIn(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	t.Setenv(web.AppTokenEnv, "the-apps-secret")
	srv := newGuardedServer(t)

	for _, path := range []string{"/api/jobs", "/api/events", "/api/capabilities", "/"} {
		if code := send(t, srv, http.MethodGet, path, nil, ""); code != http.StatusUnauthorized {
			t.Errorf("GET %s without the token answered %d", path, code)
		}
		if code := send(t, srv, http.MethodGet, path, map[string]string{"X-ArrowLoop-Token": "a guess"}, ""); code != http.StatusUnauthorized {
			t.Errorf("GET %s with a wrong token answered %d", path, code)
		}
	}
	if code := send(t, srv, http.MethodGet, "/api/jobs", map[string]string{"X-ArrowLoop-Token": "the-apps-secret"}, ""); code != http.StatusOK {
		t.Errorf("GET /api/jobs with the token answered %d", code)
	}
}

// Another app could take the port before the engine does, so the app asks
// the engine to prove it knows the token instead of sending it.
func TestTheEngineProvesItKnowsTheToken(t *testing.T) {
	t.Setenv(web.AppTokenEnv, "the-apps-secret")
	srv := newGuardedServer(t)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/capabilities", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-ArrowLoop-Challenge", "abc123")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	mac := hmac.New(sha256.New, []byte("the-apps-secret"))
	mac.Write([]byte("abc123"))
	if got, want := resp.Header.Get("X-ArrowLoop-Proof"), hex.EncodeToString(mac.Sum(nil)); got != want {
		t.Errorf("proof = %q, want %q", got, want)
	}
}

// The container and the command line set no token and carry on as before.
func TestWithoutAnAppTokenNothingIsAsked(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	t.Setenv(web.AppTokenEnv, "")
	srv := newGuardedServer(t)
	if code := send(t, srv, http.MethodGet, "/api/jobs", nil, ""); code != http.StatusOK {
		t.Errorf("GET /api/jobs answered %d", code)
	}
}
