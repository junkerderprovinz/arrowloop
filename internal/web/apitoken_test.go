package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testAPIToken = "a-long-random-token-for-castlecommander"

// tokenServer stands a server behind Protect with stand-ins for the job list,
// adding a job and the settings backup.
func tokenServer(t *testing.T) *httptest.Server {
	t.Helper()
	s := &Server{}
	mux := http.NewServeMux()
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
	mux.HandleFunc("GET /api/jobs", ok)
	mux.HandleFunc("POST /api/jobs", ok)
	mux.HandleFunc("GET /api/config/raw", ok)
	srv := httptest.NewServer(s.Protect(mux))
	t.Cleanup(srv.Close)
	return srv
}

func sendWithToken(t *testing.T, srv *httptest.Server, method, path, token string) int {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("build the request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set(tokenHeader, token)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func TestTheAPITokenAddsAJobWithoutASession(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	t.Setenv(APITokenEnv, testAPIToken)
	srv := tokenServer(t)

	if got := sendWithToken(t, srv, http.MethodPost, "/api/jobs", testAPIToken); got != http.StatusOK {
		t.Errorf("adding a job with the token answered %d", got)
	}
	if got := sendWithToken(t, srv, http.MethodGet, "/api/jobs", testAPIToken); got != http.StatusOK {
		t.Errorf("reading the job list with the token answered %d", got)
	}
	if got := sendWithToken(t, srv, http.MethodPost, "/api/jobs", ""); got != http.StatusUnauthorized {
		t.Errorf("adding a job with neither token nor session answered %d", got)
	}
}

func TestTheAPITokenOpensNothingElse(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	t.Setenv(APITokenEnv, testAPIToken)
	srv := tokenServer(t)

	for _, path := range []string{"/api/config/raw", "/api/jobs/../config/raw", "/api/jobs/photos/run"} {
		if got := sendWithToken(t, srv, http.MethodGet, path, testAPIToken); got != http.StatusUnauthorized {
			t.Errorf("GET %s with the token answered %d", path, got)
		}
	}
}

func TestAWrongTokenIsRefusedEvenWithoutAPassword(t *testing.T) {
	t.Setenv(PasswordHashEnv, "")
	t.Setenv(APITokenEnv, testAPIToken)
	srv := tokenServer(t)

	if got := sendWithToken(t, srv, http.MethodPost, "/api/jobs", "guessed"); got != http.StatusUnauthorized {
		t.Errorf("a wrong token answered %d", got)
	}
}

func TestATokenIsIgnoredWhenNoneIsSetUp(t *testing.T) {
	t.Setenv(PasswordHashEnv, testHash(t, guardedPassword))
	t.Setenv(APITokenEnv, "")
	srv := tokenServer(t)

	if got := sendWithToken(t, srv, http.MethodPost, "/api/jobs", "anything"); got != http.StatusUnauthorized {
		t.Errorf("a token on an install without one answered %d", got)
	}
}
