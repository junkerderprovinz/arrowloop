package web_test

import (
	"net/http"
	"os"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// The container's healthcheck carries no cookie, so its route has to stay open
// once a password is set, or the container turns unhealthy.
func TestTheRouteTheHealthcheckAsksForStaysOpen(t *testing.T) {
	hash, err := web.HashPassword("a password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	t.Setenv(web.PasswordHashEnv, hash)

	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	resp, err := srv.Client().Get(srv.URL + "/api/session")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the healthcheck's route answered %s with a password set", resp.Status)
	}

	// The gate has to be on for the check above to mean anything.
	shut, err := srv.Client().Get(srv.URL + "/api/jobs")
	if err != nil {
		t.Fatal(err)
	}
	defer shut.Body.Close()
	if shut.StatusCode != http.StatusUnauthorized {
		t.Errorf("with a password set, the job list answered %s; the gate is not on, so the check above is meaningless", shut.Status)
	}
}

func TestWithoutAPasswordTheHealthcheckRouteStillAnswers(t *testing.T) {
	if got := os.Getenv(web.PasswordHashEnv); got != "" {
		t.Skipf("a password hash is set in this environment: %q", got)
	}
	h := newHarness(t)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner})

	resp, err := srv.Client().Get(srv.URL + "/api/session")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("the healthcheck's route answered %s on an install with no password", resp.Status)
	}
}
