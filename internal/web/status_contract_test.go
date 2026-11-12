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

	"github.com/junkerderprovinz/parleyport/kit/hostpath"
	"github.com/junkerderprovinz/parleyport/kit/status"
	"github.com/junkerderprovinz/parleyport/kit/statustest"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// statusServer is the real API on an engine with two runs of photos behind
// it, the second of which left files for later, and a read token. mounts is
// the engine's mount table, nil for the test machine's own.
func statusServer(t *testing.T, mounts func() (hostpath.Table, error)) (http.Handler, string, *security.Store) {
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
	s := &web.Server{History: h.history, Runner: h.runner, Security: store, Key: testKey, Mounts: mounts}
	return s.Handler(), token, store
}

func TestTheStatusAnswersTheFortressContract(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	handler, token, _ := statusServer(t, nil)
	statustest.Run(t, handler, statustest.Options{Authenticate: func(r *http.Request) {
		r.Header.Set("Authorization", "Bearer "+token)
	}})
}

// dockerID is the container an engine in unraidMounts runs in. Unraid keeps
// Docker on a loop device mounted at /var/lib/docker, so the path Docker's
// hostname file has on that file system starts at /containers.
const dockerID = "4b1d9e0c7a2f5b3e8d6c1a9f0e7b2d4c6a8e0f1b3d5c7e9a2b4d6f8e0c1a3b5d"

const unraidMounts = `1203 1012 0:345 / / rw,relatime - overlay overlay rw,lowerdir=/a:/b
1210 1203 0:46 /appdata/arrowloop /config rw,noatime - fuse.shfs shfs rw
1214 1203 7:2 /containers/` + dockerID + `/resolv.conf /etc/resolv.conf rw,relatime - btrfs /dev/loop2 rw
1215 1203 7:2 /containers/` + dockerID + `/hostname /etc/hostname rw,relatime - btrfs /dev/loop2 rw
`

func TestTheStatusNamesTheContainerTheEngineRunsIn(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	inDocker, err := hostpath.Parse(strings.NewReader(unraidMounts))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		tab  hostpath.Table
		want string
	}{
		{"in a container", inDocker, dockerID},
		{"on a desktop", hostpath.Table{}, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			handler, token, _ := statusServer(t, func() (hostpath.Table, error) { return c.tab, nil })
			req := httptest.NewRequest(http.MethodGet, status.StatusPath, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			var rep status.Report
			if err := json.Unmarshal(rec.Body.Bytes(), &rep); rec.Code != http.StatusOK || err != nil {
				t.Fatalf("the status answered %d %s", rec.Code, rec.Body)
			}
			if rep.Instance.Container != c.want {
				t.Errorf("the status names the container %q, want %q", rep.Instance.Container, c.want)
			}
		})
	}
}

func TestAReadTokenGetsPastThePasswordToTheStatusOnly(t *testing.T) {
	hash, err := web.HashPassword(testKey, "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(web.PasswordHashEnv, hash)
	handler, token, _ := statusServer(t, nil)
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
