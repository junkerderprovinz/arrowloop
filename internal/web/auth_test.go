package web

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// These tests are in the package so they can shorten the session lifetime and
// test the routing guard on its own.

// guardedPassword is what every test here logs in with.
const guardedPassword = "correct horse battery staple"

// testHash hashes at the cheapest cost bcrypt allows. The cost is part of the
// hash string, so verification takes the same path as on a real install.
func testHash(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash the test password: %v", err)
	}
	return string(h)
}

// newGuarded stands up a server behind Protect, with the interface present and
// the three open routes registered as api.go registers them.
func newGuarded(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s := &Server{UI: fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>the arrowloop interface</html>")},
	}}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/session", s.session)
	mux.Handle("/", s.Handler())

	srv := httptest.NewServer(s.Protect(mux))
	t.Cleanup(srv.Close)
	return s, srv
}

// browser is a client that keeps cookies.
func browser(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookie jar: %v", err)
	}
	return &http.Client{Jar: jar}
}

func attemptLogin(t *testing.T, srv *httptest.Server, c *http.Client, password string) (*http.Response, string) {
	t.Helper()
	body, _ := json.Marshal(loginRequest{Password: password})
	resp, err := c.Post(srv.URL+"/api/login", "application/json", strings.NewReader(string(body)))
	if err != nil {
		t.Fatalf("POST /api/login: %v", err)
	}
	defer resp.Body.Close()
	said, _ := io.ReadAll(resp.Body)
	return resp, string(said)
}

func fetch(t *testing.T, c *http.Client, url string) (*http.Response, string) {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	said, _ := io.ReadAll(resp.Body)
	return resp, string(said)
}

// sessionTokenOf digs the token out of a login response.
func sessionTokenOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName {
			return c.Value
		}
	}
	t.Fatal("the login set no session cookie")
	return ""
}

// An upgrade must never lock anybody out: with no hash set the API answers,
// the interface is served, no cookie appears and the login route lets through.
func TestWithNoPasswordNothingChangesAtAll(t *testing.T) {
	t.Setenv(PasswordHashEnv, "")
	_, srv := newGuarded(t)
	c := browser(t)

	resp, said := fetch(t, c, srv.URL+"/api/capabilities")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the API answered %s on an install with no password: %s", resp.Status, said)
	}
	if !strings.Contains(said, "window") {
		t.Errorf("the API answered something other than itself: %s", said)
	}
	if len(resp.Cookies()) != 0 {
		t.Errorf("an install with no password was handed a cookie: %v", resp.Cookies())
	}

	page, body := fetch(t, c, srv.URL+"/")
	if page.StatusCode != http.StatusOK || !strings.Contains(body, "arrowloop interface") {
		t.Errorf("the interface is not being served: %s %q", page.Status, body)
	}

	var view sessionView
	probe, probed := fetch(t, c, srv.URL+"/api/session")
	if probe.StatusCode != http.StatusOK {
		t.Fatalf("the session probe answered %s", probe.Status)
	}
	if err := json.Unmarshal([]byte(probed), &view); err != nil {
		t.Fatalf("decode the probe: %v", err)
	}
	if view.Required {
		t.Error("an install with no password says a password is required")
	}
	if !view.Authenticated {
		t.Error("an install with no password says the caller is not allowed in")
	}

	if got, said := attemptLogin(t, srv, c, "anything at all"); got.StatusCode != http.StatusOK {
		t.Errorf("logging in on an install with no password answered %s: %s", got.Status, said)
	}
}

func TestAWrongPasswordIsRefusedAndOpensNothing(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	_, srv := newGuarded(t)
	c := browser(t)

	resp, said := attemptLogin(t, srv, c, "not the password")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a wrong password answered %s: %s", resp.Status, said)
	}
	for _, cookie := range resp.Cookies() {
		if cookie.Name == sessionCookieName && cookie.Value != "" {
			t.Error("a wrong password was handed a session anyway")
		}
	}
	if !strings.Contains(said, "wrong password") {
		t.Errorf("the refusal does not say what happened: %s", said)
	}

	after, _ := fetch(t, c, srv.URL+"/api/capabilities")
	if after.StatusCode != http.StatusUnauthorized {
		t.Errorf("the API answered %s after a wrong password", after.Status)
	}
}

// The cookie's attributes are checked too, since a leaking session shows up in
// no status code.
func TestTheRightPasswordLetsTheNextRequestThrough(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	_, srv := newGuarded(t)
	c := browser(t)

	shut, _ := fetch(t, c, srv.URL+"/api/capabilities")
	if shut.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the API was open before anybody logged in: %s", shut.Status)
	}

	resp, said := attemptLogin(t, srv, c, guardedPassword)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the right password answered %s: %s", resp.Status, said)
	}

	var cookie *http.Cookie
	for _, got := range resp.Cookies() {
		if got.Name == sessionCookieName {
			cookie = got
		}
	}
	if cookie == nil {
		t.Fatal("the login handed out no session cookie")
	}
	if !cookie.HttpOnly {
		t.Error("the session cookie can be read by a script on the page")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("the session cookie is SameSite=%v, so another site can post with it attached", cookie.SameSite)
	}
	if cookie.Secure {
		t.Error("the session cookie is Secure over plain HTTP, so a browser will never send it back on a home network")
	}
	if len(cookie.Value) < 32 {
		t.Errorf("the session token is only %d characters, which is guessable", len(cookie.Value))
	}

	open, body := fetch(t, c, srv.URL+"/api/capabilities")
	if open.StatusCode != http.StatusOK {
		t.Fatalf("the API is still shut after a correct login: %s %s", open.Status, body)
	}
}

// Both servers have a live session, so a check that accepted any token while
// any session was live, or handed out predictable tokens, would fail.
func TestATokenFromOneServerIsNotAcceptedByAnother(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	_, first := newGuarded(t)
	_, second := newGuarded(t)

	resp, said := attemptLogin(t, first, browser(t), guardedPassword)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logging in to the first server: %s %s", resp.Status, said)
	}
	token := sessionTokenOf(t, resp)

	elsewhere, said := attemptLogin(t, second, browser(t), guardedPassword)
	if elsewhere.StatusCode != http.StatusOK {
		t.Fatalf("logging in to the second server: %s %s", elsewhere.Status, said)
	}
	if other := sessionTokenOf(t, elsewhere); other == token {
		t.Fatal("two logins were handed the same token, so it is not being drawn at random")
	}

	// Both directions, so this cannot pass by refusing everything.
	if code := replay(t, first, token); code != http.StatusOK {
		t.Errorf("the server that minted the token answered %d", code)
	}
	if code := replay(t, second, token); code != http.StatusUnauthorized {
		t.Errorf("a second server accepted a token it never issued, answering %d", code)
	}
}

// replay presents a raw token to a server without a cookie jar in the way.
func replay(t *testing.T, srv *httptest.Server, token string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/capabilities", nil)
	if err != nil {
		t.Fatalf("build the request: %v", err)
	}
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("replay the token: %v", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

// Clearing the cookie is not enough, so the raw token is replayed afterwards,
// as somebody who copied it would.
func TestLoggingOutInvalidatesTheTokenOnTheServer(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	_, srv := newGuarded(t)
	c := browser(t)

	resp, said := attemptLogin(t, srv, c, guardedPassword)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logging in: %s %s", resp.Status, said)
	}
	token := sessionTokenOf(t, resp)
	if code := replay(t, srv, token); code != http.StatusOK {
		t.Fatalf("the token did not work before the logout, answering %d", code)
	}

	out, err := c.Post(srv.URL+"/api/logout", "application/json", strings.NewReader(""))
	if err != nil {
		t.Fatalf("POST /api/logout: %v", err)
	}
	out.Body.Close()
	if out.StatusCode != http.StatusOK {
		t.Fatalf("logging out answered %s", out.Status)
	}

	if code := replay(t, srv, token); code != http.StatusUnauthorized {
		t.Errorf("the token still works after a logout, answering %d", code)
	}
	if after, _ := fetch(t, c, srv.URL+"/api/capabilities"); after.StatusCode != http.StatusUnauthorized {
		t.Errorf("the browser is still logged in after a logout, answering %s", after.Status)
	}
}

// A browser that cannot fetch index.html has nowhere to type a password.
func TestTheInterfaceIsServedWhileTheApiIsShut(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	_, srv := newGuarded(t)
	c := browser(t)

	page, body := fetch(t, c, srv.URL+"/")
	if page.StatusCode != http.StatusOK || !strings.Contains(body, "arrowloop interface") {
		t.Errorf("the login screen cannot be reached: %s %q", page.Status, body)
	}
	if api, _ := fetch(t, c, srv.URL+"/api/capabilities"); api.StatusCode != http.StatusUnauthorized {
		t.Errorf("the API is open to a caller with no session, answering %s", api.Status)
	}
	// The probe tells the interface whether there is a login at all.
	if probe, _ := fetch(t, c, srv.URL+"/api/session"); probe.StatusCode != http.StatusOK {
		t.Errorf("the session probe is behind the lock it exists to describe, answering %s", probe.Status)
	}
}

func TestAnExpiredSessionIsRefused(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	restore := sessionLifetime
	t.Cleanup(func() { sessionLifetime = restore })

	// Still valid, which catches a guard that refuses everything.
	sessionLifetime = 10 * time.Second
	_, live := newGuarded(t)
	resp, _ := attemptLogin(t, live, browser(t), guardedPassword)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logging in with a long lifetime: %s", resp.Status)
	}
	if code := replay(t, live, sessionTokenOf(t, resp)); code != http.StatusOK {
		t.Errorf("a session well inside its lifetime was refused, answering %d", code)
	}

	sessionLifetime = 40 * time.Millisecond
	_, brief := newGuarded(t)
	short, _ := attemptLogin(t, brief, browser(t), guardedPassword)
	if short.StatusCode != http.StatusOK {
		t.Fatalf("logging in with a short lifetime: %s", short.Status)
	}
	token := sessionTokenOf(t, short)
	if code := replay(t, brief, token); code != http.StatusOK {
		t.Fatalf("a fresh session was refused, answering %d", code)
	}
	time.Sleep(80 * time.Millisecond)
	if code := replay(t, brief, token); code != http.StatusUnauthorized {
		t.Errorf("an expired session is still accepted, answering %d", code)
	}
}

// A limit that let the right password through would never stop an attacker,
// since getting it right is the last thing he does.
func TestTooManyWrongPasswordsStopEvenTheRightOne(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))

	// First catch a limiter that refuses everybody.
	_, calm := newGuarded(t)
	if resp, said := attemptLogin(t, calm, browser(t), guardedPassword); resp.StatusCode != http.StatusOK {
		t.Fatalf("the first correct password was refused: %s %s", resp.Status, said)
	}

	_, hammered := newGuarded(t)
	c := browser(t)
	for i := 0; i < maxFailedLogins; i++ {
		resp, said := attemptLogin(t, hammered, c, "not the password")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("wrong password %d answered %s: %s", i+1, resp.Status, said)
		}
	}

	resp, said := attemptLogin(t, hammered, c, guardedPassword)
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("the login still looked at a password after %d failures, answering %s: %s", maxFailedLogins, resp.Status, said)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Error("the refusal does not say how long to wait")
	}

	// Another server is untouched.
	_, other := newGuarded(t)
	if fresh, _ := attemptLogin(t, other, browser(t), guardedPassword); fresh.StatusCode != http.StatusOK {
		t.Errorf("a lockout on one server refused a correct password on another, answering %s", fresh.Status)
	}
}

// Includes paths dressed up to look like an open route or unlike an API path.
func TestOnlyTheLoginRoutesAreOpen(t *testing.T) {
	protected := []string{
		"/api/jobs",
		"/api/jobs/photos/plan",
		"/api/config",
		"/api/",
		"/api",
		"/api/login/../jobs",
		"/api/session/../config",
		"//api/jobs",
		"/api/./jobs",
		"/api/jobs/../../api/config",

		// The open routes are matched exactly, never as prefixes.
		"/api/logins",
		"/api/logout-everyone",
		"/api/session/all",
		"/api/passkeys/abc",
		"/api/passkeys/login",
		"/api/passkeys/login/begin/../../register/begin",

		// Changing what signs somebody in is for somebody signed in.
		"/api/security",
		"/api/security/password",
		"/api/security/totp/disable",
		"/api/passkeys/register/begin",
		"/api/passkeys/register/finish",
	}
	for _, p := range protected {
		if !needsSession(p) {
			t.Errorf("%q reaches the API without a session", p)
		}
	}

	open := []string{
		"/",
		"/index.html",
		"/assets/index-abc123.js",
		"/jobs",
		"/api/login",
		"/api/logout",
		"/api/session",
		"/api/passkeys",
		"/api/passkeys/login/begin",
		"/api/passkeys/login/finish",
	}
	for _, p := range open {
		if needsSession(p) {
			t.Errorf("%q is behind the lock, so nobody can get past it", p)
		}
	}
}

func TestHashPasswordRoundTrips(t *testing.T) {
	hash, err := HashPassword(guardedPassword)
	if err != nil {
		t.Fatalf("hash a password: %v", err)
	}
	if strings.Contains(hash, guardedPassword) {
		t.Fatal("the hash contains the password itself")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(guardedPassword)); err != nil {
		t.Errorf("the hash does not verify its own password: %v", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("something else")); err == nil {
		t.Error("the hash verifies a password it was not made from")
	}

	if _, err := HashPassword("   "); err == nil {
		t.Error("an empty password was accepted, which would look like protection and be none")
	}
	if _, err := HashPassword(strings.Repeat("x", 73)); err == nil || !strings.Contains(err.Error(), "72 bytes") {
		t.Errorf("a password bcrypt cannot hash gave %v", err)
	}
}

// Believing a forwarded-for header would let any caller pick a fresh lockout
// bucket for every request.
func TestTheLockoutKeyIgnoresForwardedHeaders(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	r.RemoteAddr = "203.0.113.9:5555"
	r.Header.Set("X-Forwarded-For", "10.9.9.9")
	r.Header.Set("X-Real-IP", "10.9.9.8")
	if got := clientKey(r); got != "203.0.113.9" {
		t.Fatalf("key = %q, want the real peer 203.0.113.9", got)
	}
}
