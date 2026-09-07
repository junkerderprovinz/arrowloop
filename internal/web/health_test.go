package web_test

import (
	"net/http"
	"os"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// TestTheRouteTheHealthcheckAsksForStaysOpen.
//
// The container asks this every thirty seconds and carries no cookie. Once a
// password is set, every route but three needs a session, so a healthcheck
// pointed at a protected route answers 401 and the container goes unhealthy
// every half minute on a machine where nothing at all is wrong.
//
// This test exists because that failure is entirely invisible from inside the
// app: both halves are correct on their own, the password gate is doing its job
// and the healthcheck is doing its job, and the only symptom is a red container
// somebody has to go and diagnose.
func TestTheRouteTheHealthcheckAsksForStaysOpen(t *testing.T) {
	// A real hash, so the gate is genuinely on. Generated here rather than
	// pasted, because a stale constant is a test that silently stops testing.
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

	// And the gate really is on, or the test above proves nothing: a route that
	// SHOULD be shut has to be shut in the same breath.
	shut, err := srv.Client().Get(srv.URL + "/api/jobs")
	if err != nil {
		t.Fatal(err)
	}
	defer shut.Body.Close()
	if shut.StatusCode != http.StatusUnauthorized {
		t.Errorf("with a password set, the job list answered %s; the gate is not on, so the check above is meaningless", shut.Status)
	}
}

// TestWithoutAPasswordTheHealthcheckRouteStillAnswers.
//
// The ordinary install, which is every install today.
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
