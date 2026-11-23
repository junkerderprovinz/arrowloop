package web_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/hostpath"
	"github.com/junkerderprovinz/parleyport/kit/signin"
	"github.com/junkerderprovinz/parleyport/kit/status"
	"github.com/junkerderprovinz/parleyport/kit/statustest"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// statusServer is the real API on an engine with two runs of photos behind
// it, the second of which left files for later, and a read token the version
// before the sign-in made. mounts is the engine's mount table, nil for the
// test machine's own.
func statusServer(t *testing.T, mounts func() (hostpath.Table, error)) (http.Handler, string) {
	t.Helper()
	h := newHarness(t)
	ctx := context.Background()
	base := time.Now().Add(-time.Hour)
	for i, skipped := range []int{0, 2} {
		at := base.Add(time.Duration(i) * time.Minute)
		if err := h.history.Record(ctx, history.Run{JobID: jobID(t, h, "photos"), Job: "photos", Started: at, Finished: at.Add(time.Second), Copied: 1, Skipped: skipped}, nil); err != nil {
			t.Fatal(err)
		}
	}
	old, err := security.Open(h.configPath, testKey)
	if err != nil {
		t.Fatal(err)
	}
	token := "alr_a-token-the-version-before-made"
	if err := old.Update(func(st *security.State) error {
		st.ReadTokens = []security.ReadToken{{ID: "1", Name: "Homepage", Hash: security.ReadTokenDigest(testKey, token), CreatedAt: 1700000000}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	s := &web.Server{History: h.history, Runner: h.runner, SignIn: web.OpenSignIn(t, h.dir, testKey, ""), Key: testKey, Mounts: mounts}
	return s.Handler(), token
}

// While nobody can sign in, the whole API is open, the status with it, so the
// contract is checked where a password is set.
func TestTheStatusAnswersTheFortressContract(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, testHash(t, "correct horse battery staple"))
	handler, token := statusServer(t, nil)
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
			handler, token := statusServer(t, func() (hostpath.Table, error) { return c.tab, nil })
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
	t.Setenv(web.PasswordHashEnv, testHash(t, "correct horse battery staple"))
	handler, token := statusServer(t, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	for path, want := range map[string]int{status.StatusPath: http.StatusOK, status.LogPath: http.StatusOK, "/api/jobs": http.StatusForbidden, "/api/config/raw": http.StatusForbidden} {
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
	resp, err := srv.Client().Get(srv.URL + status.StatusPath)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the status without a token answered %s", resp.Status)
	}
}

func TestATokenThatReadsIsMadeListedAndEndedThroughTheSignIn(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, testHash(t, "correct horse battery staple"))
	handler, _ := statusServer(t, nil)
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := sameSite()
	send := func(method, path, body string, into any) int {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if into != nil {
			_ = json.NewDecoder(resp.Body).Decode(into)
		}
		return resp.StatusCode
	}
	if code := send("POST", signin.APIPrefix+"login", `{"password":"correct horse battery staple"}`, nil); code != http.StatusOK {
		t.Fatalf("signing in answered %d", code)
	}
	var made struct {
		Token struct{ ID string }
		Value string
	}
	if code := send("POST", signin.APIPrefix+"me/tokens", `{"name":"Homarr","scopes":["read"]}`, &made); code != http.StatusOK || made.Value == "" {
		t.Fatalf("making a token answered %d %+v", code, made)
	}
	var list struct{ Tokens []map[string]any }
	send("GET", signin.APIPrefix+"me/tokens", "", &list)
	if len(list.Tokens) != 2 {
		t.Fatalf("the list holds %v, not the old token and the new one", list.Tokens)
	}
	reads := func() int {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+status.StatusPath, nil)
		req.Header.Set("Authorization", "Bearer "+made.Value)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := reads(); code != http.StatusOK {
		t.Fatalf("the new token reads the status with %d", code)
	}
	if code := send("DELETE", signin.APIPrefix+"me/tokens/"+made.Token.ID, "", nil); code != http.StatusOK {
		t.Fatalf("ending the token answered %d", code)
	}
	if code := reads(); code != http.StatusUnauthorized {
		t.Errorf("the ended token still reads the status with %d", code)
	}
}

func TestTheStatusCarriesArrowLoopsLogo(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	handler, token := statusServer(t, nil)
	req := httptest.NewRequest(http.MethodGet, status.StatusPath, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var rep status.Report
	if err := json.Unmarshal(rec.Body.Bytes(), &rep); rec.Code != http.StatusOK || err != nil {
		t.Fatalf("the status answered %d %s", rec.Code, rec.Body)
	}
	if err := status.CheckIcon(rep.App.Icon); err != nil {
		t.Errorf("the status carries no logo: %v", err)
	}
}
