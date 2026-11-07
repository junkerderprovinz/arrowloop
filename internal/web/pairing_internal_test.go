package web

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/federation"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
)

// Another member of the group reads the jobs and starts or stops one. What
// would change this instance's settings, empty its trash or hand out its
// phrase stays with the owner at it.
func TestTheGroupReachesOnlyTheJobs(t *testing.T) {
	dir := t.TempDir()
	store, err := pairing.Open(dir, bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	group, err := federation.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Pairing: store, Group: group}
	for _, c := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, federation.HelloPath, http.StatusOK},
		{http.MethodGet, "/api/config", http.StatusNotFound},
		{http.MethodPut, "/api/config", http.StatusNotFound},
		{http.MethodGet, "/api/settings", http.StatusNotFound},
		{http.MethodGet, "/api/remotes", http.StatusNotFound},
		{http.MethodPost, "/api/jobs/photos/trash/left/empty", http.StatusNotFound},
		{http.MethodPost, "/api/connect/reveal", http.StatusNotFound},
		{http.MethodPost, "/api/security/password/remove", http.StatusNotFound},
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
