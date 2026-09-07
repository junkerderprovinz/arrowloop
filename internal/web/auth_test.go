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

// These tests live inside the package rather than beside it in web_test,
// because two of them cannot be written from the outside at all: the session
// lifetime has to be shortened to reach the expiry path without waiting half a
// day for it, and the routing guard is worth testing on its own rather than
// only through whichever addresses happen to be registered today.

// guardedPassword is what every test here logs in with.
const guardedPassword = "correct horse battery staple"

// testHash hashes at the CHEAPEST cost bcrypt allows.
//
// Deliberate, and it does not weaken what is under test: the cost lives in the
// hash string itself, so the verification path taken here is byte for byte the
// one a real install takes, only faster. Hashing at the shipped cost in every
// one of these tests would spend most of the suite's time proving that bcrypt
// is slow, which is the one thing about bcrypt nobody doubts.
func testHash(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash the test password: %v", err)
	}
	return string(h)
}

// newGuarded stands up a server behind Protect, with the interface present.
//
// The three open routes are registered here EXACTLY as api.go has to register
// them, so these tests fail if the lines handed over are wrong, rather than
// passing against a mounting that only exists in the test.
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

// browser is a client that keeps cookies, which is the only way a test can act
// like the thing this feature is for.
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

// TestWithNoPasswordNothingChangesAtAll is the promise the whole feature is
// built around, and it is the test that has to keep passing when everything
// else here is rewritten.
//
// An install that has set no hash must not be able to tell that any of this was
// added: the API answers, the interface is served, no cookie appears, and even
// the login route refuses to become a wall. The failure it prevents is an
// upgrade that locks somebody out of the machine holding his own photos.
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

	// And the login route does not become a wall on the way. Somebody who
	// posts to it on an unprotected install gets told there is nothing to log
	// in to, not a refusal that would leave a login screen unable to proceed.
	if got, said := attemptLogin(t, srv, c, "anything at all"); got.StatusCode != http.StatusOK {
		t.Errorf("logging in on an install with no password answered %s: %s", got.Status, said)
	}
}

// TestAWrongPasswordIsRefusedAndOpensNothing.
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
	// The refusal says the same thing whatever went wrong, so it cannot be used
	// to ask questions about this install.
	if !strings.Contains(said, "wrong password") {
		t.Errorf("the refusal does not say what happened: %s", said)
	}

	after, _ := fetch(t, c, srv.URL+"/api/capabilities")
	if after.StatusCode != http.StatusUnauthorized {
		t.Errorf("the API answered %s after a wrong password", after.Status)
	}
}

// TestTheRightPasswordLetsTheNextRequestThrough is the other direction of the
// same guard, and it checks the cookie's own attributes rather than only that
// one arrived. A session that is readable by a script or sent on a cross-site
// post is a session that leaks, and neither of those shows up in a status code.
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

// TestATokenFromOneServerIsNotAcceptedByAnother.
//
// The sessions have to belong to the server that minted them. A store shared
// across servers would pass every other test in this file while being wrong,
// and the day this grows a second listener the tokens would be interchangeable
// between them.
//
// SOMEBODY IS LOGGED IN TO BOTH, which is the part that makes this test worth
// having. Presenting a foreign token to a server with no sessions at all proves
// nothing: a check that accepted any token whenever ANY session was live would
// walk straight through it, and so would one that handed both servers the same
// predictable token. The second server has a live session of its own and still
// has to refuse the first server's token.
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

	// The same token, presented by hand, to each server in turn. Both
	// directions, so this cannot pass by refusing everything.
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

// TestLoggingOutInvalidatesTheTokenOnTheServer.
//
// Clearing the cookie in the browser is not logging out, it is asking the
// browser to forget something the server still honours. The test therefore
// replays the raw token afterwards, which is exactly what somebody who copied
// it off a shared machine would do.
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

// TestTheInterfaceIsServedWhileTheApiIsShut records the choice made at the top
// of auth.go rather than merely allowing it: the static files are open on
// purpose, because a browser that cannot fetch index.html has nowhere to type a
// password.
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
	// The probe is open too, so the interface can tell "logged out" from "there
	// is no login here" without reading a refusal to find out.
	if probe, _ := fetch(t, c, srv.URL+"/api/session"); probe.StatusCode != http.StatusOK {
		t.Errorf("the session probe is behind the lock it exists to describe, answering %s", probe.Status)
	}
}

// TestAnExpiredSessionIsRefused, with the lifetime shortened so the expiry path
// is reached in a test rather than only after half a day of running.
func TestAnExpiredSessionIsRefused(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	restore := sessionLifetime
	t.Cleanup(func() { sessionLifetime = restore })

	// Long enough to still be valid, which is the direction that catches a
	// guard that simply refuses everything.
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

// TestTooManyWrongPasswordsStopEvenTheRightOne.
//
// The delay alone is not a rate limit, because an attacker pays it in parallel.
// This is the guard that actually bounds the guessing, and the way to prove it
// is real is that the CORRECT password is refused once the count is spent: a
// limit that let the right password through would be a limit an attacker never
// meets, since getting it right is the last thing he does.
func TestTooManyWrongPasswordsStopEvenTheRightOne(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))

	// First the direction that catches a limiter that refuses everybody.
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

	// A different server is untouched, which is the same per-server separation
	// the token test pins and matters here for a different reason: one person
	// getting locked out must not be everybody.
	_, other := newGuarded(t)
	if fresh, _ := attemptLogin(t, other, browser(t), guardedPassword); fresh.StatusCode != http.StatusOK {
		t.Errorf("a lockout on one server refused a correct password on another, answering %s", fresh.Status)
	}
}

// TestOnlyTheThreeOpenRoutesAreOpen tests the routing guard directly, including
// the shapes that are built to look like something they are not. A path is
// cleaned before it is judged, so an address that reaches a protected handler
// cannot reach it while wearing the login's name.
func TestOnlyTheThreeOpenRoutesAreOpen(t *testing.T) {
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

		// The three open routes are matched EXACTLY, never as prefixes. A
		// prefix would open every address that happens to start with one of
		// their names, and the next route somebody adds beside the logout is
		// then quietly outside the lock.
		"/api/logins",
		"/api/logout-everyone",
		"/api/session/all",
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
	}
	for _, p := range open {
		if needsSession(p) {
			t.Errorf("%q is behind the lock, so nobody can get past it", p)
		}
	}
}

// TestHashPasswordRoundTrips, and refuses the empty password that would look
// like protection while being none.
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
}
