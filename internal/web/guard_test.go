package web_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

func newGuardedServer(t *testing.T) *httptest.Server {
	t.Helper()
	h := newHarness(t)
	s := &web.Server{History: h.history, Runner: h.runner, Key: testKey}
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

// A page on any site can send a POST to 127.0.0.1 without asking first.
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
		{"Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"},
		// The phone app and scripts send neither header.
		{"Content-Type": "application/json"},
	}
	for _, header := range allowed {
		if code := send(t, srv, http.MethodPost, "/api/jobs/nope/stop", header, ""); code != http.StatusNotFound {
			t.Errorf("a POST with %v answered %d, want the route's own 404", header, code)
		}
	}
}

// Whoever runs the install decides whether it wants a password, so without
// one it answers on whatever name it is reached by, a reverse proxy's too.
func TestWithoutAPasswordAnyNameIsServed(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)

	for _, host := range []string{
		"arrowloop.example.com", "sync.example.com:443", "127.0.0.1:8422", "[::1]:8422",
		"192.168.1.5:8422", "localhost:8422", "tower:8422", "nas.local",
	} {
		if code := send(t, srv, http.MethodGet, "/api/jobs", nil, host); code != http.StatusOK {
			t.Errorf("host %s answered %d", host, code)
		}
	}
}

// With a password the cookie belongs to the name it was set on, so a
// re-pointed name gets nothing, and a reverse proxy's name has to work.
func TestWithAPasswordAnyNameIsServed(t *testing.T) {
	hash, err := web.HashPassword(testKey, "correct horse battery staple")
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

// A page on any site can POST a form or text/plain without the browser asking
// this server first, and the handlers read a JSON body whatever the header says.
func TestAChangeHasToBeSentAsJSON(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)

	for _, kind := range []string{"", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/x-kit-upload"} {
		header := map[string]string{}
		if kind != "" {
			header["Content-Type"] = kind
		}
		if code := send(t, srv, http.MethodPost, "/api/jobs/nope/stop", header, ""); code != http.StatusUnsupportedMediaType {
			t.Errorf("a POST sent as %q answered %d", kind, code)
		}
	}
	if code := send(t, srv, http.MethodPost, "/api/jobs/nope/stop", map[string]string{"Content-Type": "application/json; charset=utf-8"}, ""); code != http.StatusNotFound {
		t.Errorf("a POST sent as JSON answered %d, want the route's own 404", code)
	}
	if code := send(t, srv, http.MethodGet, "/api/jobs", nil, ""); code != http.StatusOK {
		t.Errorf("a GET without a type answered %d", code)
	}
}

// A password is optional, so an install without one may do everything,
// reading and restoring the backup and deleting for good included.
func TestWithoutAPasswordEveryRouteIsOpen(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)
	json := map[string]string{"Content-Type": "application/json"}

	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/config/raw"},
		{http.MethodPut, "/api/config/raw"},
		{http.MethodGet, "/api/config/backups/arrowloop-auto-20261107-120000.json"},
		{http.MethodPost, "/api/notify/test"},
		{http.MethodDelete, "/api/jobs/photos/state"},
		{http.MethodDelete, "/api/remotes/cloud"},
		{http.MethodPost, "/api/jobs/photos/trash/left/empty"},
		{http.MethodPost, "/api/jobs/photos/trash/right/delete"},
		{http.MethodPost, "/api/jobs/photos/trash/left/prune"},
	} {
		if code := send(t, srv, c.method, c.path, json, "arrowloop.example.com"); code == http.StatusForbidden || code == http.StatusMisdirectedRequest {
			t.Errorf("%s %s answered %d without a password", c.method, c.path, code)
		}
	}
	if code := send(t, srv, http.MethodGet, "/api/config/raw", nil, ""); code != http.StatusOK {
		t.Errorf("the settings backup answered %d without a password", code)
	}
}

// The phone app's engine has no password and is reached only by the app.
func TestTheAppMayDoWithoutAPassword(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	t.Setenv(web.AppTokenEnv, "the-apps-secret")
	srv := newGuardedServer(t)
	header := map[string]string{"X-ArrowLoop-Token": "the-apps-secret"}
	if code := send(t, srv, http.MethodGet, "/api/config/raw", header, ""); code != http.StatusOK {
		t.Errorf("the app's backup answered %d", code)
	}
}

// A page another app of the fortress opens runs sandboxed under this
// instance's address, in an origin of its own: the browser sends its writes
// as cross-site, from Origin null, and they must not reach the API even with
// this instance's session cookie, which SameSite=Lax holds back anyway.
func TestAnOpenedPageCannotChangeAnythingHere(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)
	json := map[string]string{"Content-Type": "application/json"}
	for _, from := range []map[string]string{
		{"Sec-Fetch-Site": "cross-site", "Origin": "null"},
		{"Origin": "null"},
	} {
		header := map[string]string{"Cookie": "arrowloop_session=whatever"}
		for k, v := range json {
			header[k] = v
		}
		for k, v := range from {
			header[k] = v
		}
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			if code := send(t, srv, method, "/api/jobs/nope/stop", header, ""); code != http.StatusForbidden {
				t.Errorf("%s with %v answered %d", method, from, code)
			}
		}
	}
}

// The opened page's own requests go to the fortress's path as cross-site
// writes, which the fortress answers itself, not the guard in front of the
// API.
func TestTheFortressAnswersTheRequestsOfAnOpenedPage(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	srv := newGuardedServer(t)
	header := map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "null", "Content-Type": "text/plain"}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		code := send(t, srv, method, "/fortress/open/0123456789abcdef0123456789abcdef/api/jobs", header, "attacker.example")
		if code == http.StatusForbidden || code == http.StatusUnsupportedMediaType || code == http.StatusMisdirectedRequest {
			t.Errorf("%s through the fortress was refused by the guard with %d", method, code)
		}
	}
}
