package web

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/junkerderprovinz/parleyport/kit/group"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
)

// The routes another member of the group reaches, all of them. A route added
// to the group has to be added here too, so nobody widens it by accident.
var groupAllowlist = []string{
	"GET " + legacyHelloPath,
	"GET /api/jobs",
	"POST /api/jobs/{name}/run",
	"POST /api/jobs/{name}/stop",
	"GET /api/jobs/{name}/config",
	"PUT /api/jobs/{name}/config",
	"GET /api/places",
	"GET /api/browse",
	"DELETE /api/connect/members/{id}",
	"POST /api/connect/devices/{id}/approve",
	"POST /api/connect/devices/{id}/refuse",
	"POST " + changedPhrasePath,
}

func TestTheGroupRoutesAreTheAllowlist(t *testing.T) {
	var got []string
	for _, r := range groupRoutes() {
		got = append(got, r.pattern)
	}
	if !slices.Equal(got, groupAllowlist) {
		t.Errorf("the group reaches %q, want exactly %q", got, groupAllowlist)
	}
}

func TestTheGroupReachesNothingElse(t *testing.T) {
	dir := t.TempDir()
	store, err := pairing.Open(dir, bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Pairing: store}
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, legacyHelloPath, http.StatusOK},
		{http.MethodGet, "/api/config", http.StatusNotFound},
		{http.MethodPut, "/api/config", http.StatusNotFound},
		{http.MethodGet, "/api/config/raw", http.StatusNotFound},
		{http.MethodPut, "/api/config/raw", http.StatusNotFound},
		{http.MethodGet, "/api/settings", http.StatusNotFound},
		{http.MethodPut, "/api/settings", http.StatusNotFound},
		{http.MethodGet, "/api/remotes", http.StatusNotFound},
		{http.MethodPut, "/api/remotes/vault", http.StatusNotFound},
		{http.MethodDelete, "/api/remotes/vault", http.StatusNotFound},
		{http.MethodPost, "/api/remotes/vault/check", http.StatusNotFound},
		{http.MethodPost, "/api/jobs", http.StatusNotFound},
		{http.MethodDelete, "/api/jobs/photos/config", http.StatusNotFound},
		{http.MethodPost, "/api/jobs/photos/config", http.StatusNotFound},
		{http.MethodDelete, "/api/jobs/photos/state", http.StatusNotFound},
		{http.MethodPut, "/api/jobs/order", http.StatusNotFound},
		{http.MethodPost, "/api/browse/mkdir", http.StatusNotFound},
		{http.MethodGet, "/api/trash", http.StatusNotFound},
		{http.MethodGet, "/api/jobs/photos/trash/left", http.StatusNotFound},
		{http.MethodPost, "/api/jobs/photos/trash/left/empty", http.StatusNotFound},
		{http.MethodPost, "/api/import", http.StatusNotFound},
		{http.MethodGet, "/api/diagnostics", http.StatusNotFound},
		{http.MethodGet, "/api/connect", http.StatusNotFound},
		{http.MethodPost, "/api/connect/reveal", http.StatusNotFound},
		{http.MethodPut, "/api/relay/config", http.StatusNotFound},
		{http.MethodPost, "/api/security/password/remove", http.StatusNotFound},
		{http.MethodPost, "/api/volumes", http.StatusNotFound},
		{http.MethodDelete, "/api/connect/members/" + string(bytes.Repeat([]byte("a"), 40)), http.StatusForbidden},
		{http.MethodPost, "/api/connect/devices/x/approve", http.StatusForbidden},
	} {
		rec := httptest.NewRecorder()
		s.groupHandler().ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		if rec.Code != c.want {
			t.Errorf("%s %s from the group = %d, want %d", c.method, c.path, rec.Code, c.want)
		}
	}
}

// Handler registers the direct route by its path, so the open routes can be
// checked against the source; it has to be the one the group calls.
func TestTheDirectRouteIsWhereTheGroupCalls(t *testing.T) {
	if group.DirectPath != "/api/group/call" {
		t.Errorf("the group calls %s, but Handler serves /api/group/call", group.DirectPath)
	}
}
