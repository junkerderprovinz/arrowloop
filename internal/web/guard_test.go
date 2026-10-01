package web_test

import (
	"net/http"
	"net/http/httptest"
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
	} {
		if code := send(t, srv, http.MethodGet, "/api/jobs", nil, host); code != http.StatusOK {
			t.Errorf("host %s answered %d", host, code)
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
