package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/status"
	"github.com/junkerderprovinz/parleyport/kit/statustest"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// statusServer is the real API on an engine with two runs of photos behind
// it, the second of which left files for later, and a read token.
func statusServer(t *testing.T) (http.Handler, string, *security.Store) {
	t.Helper()
	h := newHarness(t)
	ctx := context.Background()
	base := time.Now().Add(-time.Hour)
	for i, skipped := range []int{0, 2} {
		at := base.Add(time.Duration(i) * time.Minute)
		if err := h.history.Record(ctx, history.Run{Job: "photos", Started: at, Finished: at.Add(time.Second), Copied: 1, Skipped: skipped}, nil); err != nil {
			t.Fatal(err)
		}
	}
	store, err := security.Open(h.configPath, testKey)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := store.AddReadToken("Homepage", time.Now().Unix())
	if err != nil {
		t.Fatal(err)
	}
	s := &web.Server{History: h.history, Runner: h.runner, Security: store, Key: testKey}
	return s.Handler(), token, store
}

func TestTheStatusAnswersTheFortressContract(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	handler, token, _ := statusServer(t)
	statustest.Run(t, handler, statustest.Options{Authenticate: func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+token)
	}})
}

func TestAReadTokenGetsPastThePasswordToTheStatusOnly(t *testing.T) {
	hash, err := web.HashPassword(testKey, "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(web.PasswordHashEnv, hash)
	handler, token, _ := statusServer(t)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	for path, want := range map[string]int{status.StatusPath: http.StatusOK, status.LogPath: http.StatusOK, "/api/jobs": http.StatusUnauthorized, "/api/config/raw": http.StatusUnauthorized} {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("GET %s with the read token answered %d, want %d", path, resp.StatusCode, want)
		}
	}
}

func TestReadTokensAreMadeListedAndDeletedThroughTheAPI(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	h := newHarness(t)
	store, err := security.Open(h.configPath, testKey)
	if err != nil {
		t.Fatal(err)
	}
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, Security: store, Key: testKey})
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}

	resp, err := c.Post(srv.URL+"/api/security/read-tokens", "application/json", strings.NewReader(`{"name":"Homarr"}`))
	if err != nil {
		t.Fatal(err)
	}
	var made struct {
		ID, Name, Token string
	}
	json.NewDecoder(resp.Body).Decode(&made)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || made.Token == "" || made.Name != "Homarr" {
		t.Fatalf("making a token answered %s with %+v", resp.Status, made)
	}

	var list []map[string]any
	getJSON(t, srv, "/api/security/read-tokens", &list)
	if len(list) != 1 || list[0]["name"] != "Homarr" || list[0]["id"] != made.ID {
		t.Fatalf("the list is %v", list)
	}
	for key := range list[0] {
		if key == "hash" || key == "token" {
			t.Errorf("the list hands out %q", key)
		}
	}

	if resp, _ := doJSON(t, srv, http.MethodDelete, "/api/security/read-tokens/"+made.ID, ""); resp.StatusCode != http.StatusOK {
		t.Fatalf("deleting answered %s", resp.Status)
	}
	if _, ok := store.MatchReadToken(made.Token); ok {
		t.Error("the deleted token still opens")
	}
}
