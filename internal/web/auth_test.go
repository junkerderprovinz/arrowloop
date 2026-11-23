package web

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	"golang.org/x/crypto/bcrypt"

	"github.com/junkerderprovinz/parleyport/kit/signin"
	"github.com/junkerderprovinz/parleyport/kit/signin/signintest"
)

// guardedPassword is what every test here signs in with.
const guardedPassword = "correct horse battery staple"

var guardKey = []byte("0123456789abcdef0123456789abcdef")

// testHash hashes at the cheapest cost bcrypt allows. The cost is part of the
// hash string, so checking it takes the same path as on a real install.
func testHash(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash the test password: %v", err)
	}
	return string(h)
}

// guarded stands up the sign-in, Protect and a stand-in for the job list and
// the interface, wired as Handler wires them, with password set in the
// interface unless it is empty.
func guarded(t *testing.T, password string) (*Server, *httptest.Server) {
	t.Helper()
	s := &Server{SignIn: OpenSignIn(t, t.TempDir(), guardKey, password), UI: fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>the arrowloop interface</html>")},
	}}
	mux := http.NewServeMux()
	s.signInRoutes(mux)
	mux.HandleFunc("GET "+passwordSourcePath, s.passwordSource)
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
	mux.HandleFunc("GET /api/jobs", ok)
	mux.HandleFunc("POST /api/jobs", ok)
	mux.HandleFunc("GET /api/config/raw", ok)
	mux.Handle("/", spa{fs: s.UI, assets: &assets{}})
	srv := httptest.NewServer(s.SignIn.Guard(s.Protect(mux)))
	t.Cleanup(srv.Close)
	return s, srv
}

// visitor is a browser on the interface's own page.
type visitor struct {
	t   *testing.T
	srv *httptest.Server
	c   *http.Client
}

func newVisitor(t *testing.T, srv *httptest.Server) *visitor {
	jar, _ := cookiejar.New(nil)
	return &visitor{t: t, srv: srv, c: &http.Client{Jar: jar}}
}

func (v *visitor) send(method, path string, body any, header ...string) (int, map[string]any) {
	v.t.Helper()
	raw, _ := json.Marshal(body)
	if body == nil {
		raw = nil
	}
	req, err := http.NewRequest(method, v.srv.URL+path, bytes.NewReader(raw))
	if err != nil {
		v.t.Fatal(err)
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	resp, err := v.c.Do(req)
	if err != nil {
		v.t.Fatal(err)
	}
	defer resp.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (v *visitor) signIn(password string) {
	v.t.Helper()
	if code, out := v.send("POST", signin.APIPrefix+"login", map[string]string{"password": password}); code != http.StatusOK {
		v.t.Fatalf("signing in answered %d %v", code, out)
	}
}

func TestWithoutAPasswordEverythingIsOpen(t *testing.T) {
	_, srv := guarded(t, "")
	v := newVisitor(t, srv)
	if code, _ := v.send("GET", "/api/jobs", nil); code != http.StatusOK {
		t.Fatalf("an install without a password answered %d", code)
	}
}

func TestWithAPasswordTheAPIWaitsForASignIn(t *testing.T) {
	_, srv := guarded(t, guardedPassword)
	v := newVisitor(t, srv)
	if code, out := v.send("GET", "/api/jobs", nil); code != http.StatusUnauthorized || out["code"] != "signInFirst" {
		t.Fatalf("the job list answered %d %v before anyone signed in", code, out)
	}
	// A browser refused index.html would have nowhere to type a password.
	if resp, err := v.c.Get(srv.URL + "/"); err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("the interface itself is shut: %v %v", resp, err)
	}
	if code, _ := v.send("POST", signin.APIPrefix+"login", map[string]string{"password": "wrong"}); code != http.StatusUnauthorized {
		t.Fatalf("a wrong password answered %d", code)
	}
	v.signIn(guardedPassword)
	if code, _ := v.send("GET", "/api/jobs", nil); code != http.StatusOK {
		t.Fatalf("signed in, the job list answered %d", code)
	}
	v.send("POST", signin.APIPrefix+"logout", nil)
	if code, _ := v.send("GET", "/api/jobs", nil); code != http.StatusUnauthorized {
		t.Fatalf("signed out, the job list answered %d", code)
	}
}

func TestAnAPITokenOpensWhatItsScopesAllow(t *testing.T) {
	_, srv := guarded(t, guardedPassword)
	v := newVisitor(t, srv)
	v.signIn(guardedPassword)
	tokenOf := func(scope string) string {
		code, out := v.send("POST", signin.APIPrefix+"me/tokens", map[string]any{"name": scope, "scopes": []string{scope}})
		if code != http.StatusOK {
			t.Fatalf("making a %s token answered %d %v", scope, code, out)
		}
		return out["value"].(string)
	}
	read, all := tokenOf("read"), tokenOf("all")
	stranger := newVisitor(t, srv)
	if code, _ := stranger.send("GET", "/api/jobs", nil, "Authorization", "Bearer "+read); code != http.StatusForbidden {
		t.Errorf("a token that reads the status opened the job list with %d", code)
	}
	if code, _ := stranger.send("GET", "/api/jobs", nil, "Authorization", "Bearer "+all); code != http.StatusOK {
		t.Errorf("a token for everything was refused the job list with %d", code)
	}
	if code, _ := stranger.send("GET", "/api/jobs", nil, "Authorization", "Bearer "+all+"x"); code != http.StatusUnauthorized {
		t.Errorf("a token one character off answered %d", code)
	}
}

func TestThePasswordFromTheEnvironmentIsNeitherChangedNorResetHere(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	_, srv := guarded(t, "")
	v := newVisitor(t, srv)
	if code, _ := v.send("GET", "/api/jobs", nil); code != http.StatusUnauthorized {
		t.Fatalf("the hash from the environment left the job list open with %d", code)
	}
	// The sign-in page reads this before anyone signed in, to leave out the reset.
	if code, out := v.send("GET", passwordSourcePath, nil); code != http.StatusOK || out["fromEnv"] != true {
		t.Fatalf("the password's source answered %d %v", code, out)
	}
	v.signIn(guardedPassword)
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"PUT", "me/password", map[string]string{"current": guardedPassword, "next": "another one"}},
		{"DELETE", "me/password", map[string]string{"current": guardedPassword}},
		{"POST", "reset-code", nil},
		{"POST", "reset", map[string]string{"code": "AAAA-BBBB-CCCC", "password": "another one"}},
	} {
		if code, out := v.send(c.method, signin.APIPrefix+c.path, c.body); code != http.StatusConflict || out["error"] != passwordFromEnv {
			t.Errorf("%s %s answered %d %v", c.method, c.path, code, out)
		}
	}
	v.signIn(guardedPassword)
}

func TestTheSignInKeepsTheContract(t *testing.T) {
	_, srv := guarded(t, "")
	signintest.Run(t, srv.Config.Handler, signintest.Options{Password: guardedPassword})
}

// Includes paths dressed up to look like an open route or unlike an API path.
func TestOnlyTheSignInRoutesAreOpen(t *testing.T) {
	protected := []string{
		"/api/jobs",
		"/api/jobs/photos/plan",
		"/api/config",
		"/api/",
		"/api",
		"/api/signin/v1/../../jobs",
		"/api/signin/../config",
		"//api/jobs",
		"/api/./jobs",
		"/api/jobs/../../api/config",
		"/api/signin",
		"/api/signin/v2/login",
		"/api/fortress/v1/statuses",
		"/api/login",
		"/api/session",
	}
	for _, p := range protected {
		if !needsSession(p) {
			t.Errorf("%q reaches the API without a visitor", p)
		}
	}
	open := []string{
		"/",
		"/index.html",
		"/assets/index-abc123.js",
		"/jobs",
		"/signin/oidc/callback",
		"/api/signin/v1/options",
		"/api/signin/v1/login",
		"/api/fortress/v1/status",
	}
	for _, p := range open {
		if needsSession(p) {
			t.Errorf("%q is behind the lock, so nobody can get past it", p)
		}
	}
}

// registered reads every route Handler registers from its source, as the mux
// sees it: the method, if any, and the pattern.
func registered(t *testing.T) map[string][]string {
	t.Helper()
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatal(err)
	}
	routes := map[string][]string{}
	for _, m := range regexp.MustCompile(`mux\.Handle(?:Func)?\("(?:([A-Z]+) )?(/[^"]*)"`).FindAllStringSubmatch(string(src), -1) {
		routes[m[2]] = append(routes[m[2]], m[1])
	}
	if len(routes) < 20 {
		t.Fatalf("read only %d routes from api.go; the pattern no longer matches how routes are registered", len(routes))
	}
	return routes
}

// The open list is the only way past the sign-in, so it must name routes that
// exist, and nothing registered under /api may be open by accident.
func TestEveryOpenRouteIsARegisteredOne(t *testing.T) {
	routes := registered(t)
	for p := range openRoutes {
		if _, ok := routes[p]; !ok {
			t.Errorf("%s is open without a visitor, but no such route is registered", p)
		}
	}
	for p := range routes {
		if !strings.HasPrefix(p, "/api") {
			continue
		}
		concrete := regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(p, "x")
		if !needsSession(concrete) && !openRoutes[p] {
			t.Errorf("%s answers without a visitor, though it is not on the open list", p)
		}
	}
}
