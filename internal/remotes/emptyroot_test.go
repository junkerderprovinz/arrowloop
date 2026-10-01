package remotes

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

// A WebDAV server that lets the login in but keeps nothing at the address, as
// OpenCloud answers for /dav/ itself.
func nothingHere(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, _, ok := r.BasicAuth(); !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv.URL + "/dav/"
}

func TestAWebdavAddressWithNothingThereFailsTheCheck(t *testing.T) {
	settings := map[string]string{"url": nothingHere(t), "user": "someone", "pass": "secret"}
	if err := CheckSettings(context.Background(), "webdav", settings); err == nil {
		t.Fatal("an address that answers 404 passed the check")
	}
}

func TestASavedWebdavAddressWithNothingThereFailsTheCheck(t *testing.T) {
	ownConfig(t)
	const name = "arrowloop-test-nothing-here"
	if err := Save(name, "webdav", map[string]string{"url": nothingHere(t), "user": "someone", "pass": "secret"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { _ = Delete(name) })

	if err := Check(context.Background(), name); err == nil {
		t.Fatal("a saved address that answers 404 passed the check")
	}
}

func TestAFolderNotMadeYetStillPassesTheCheck(t *testing.T) {
	ownConfig(t)
	const name = "arrowloop-test-not-made-yet"
	if err := Save(name, "alias", map[string]string{"remote": filepath.Join(t.TempDir(), "later")}); err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { _ = Delete(name) })

	if err := Check(context.Background(), name); err != nil {
		t.Fatalf("a folder the first run will make failed the check: %v", err)
	}
}
