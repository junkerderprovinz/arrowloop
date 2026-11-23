package web_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"testing"

	"github.com/junkerderprovinz/parleyport/kit/signin"
	"golang.org/x/crypto/bcrypt"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// sameSite is the interface's own page: a browser with cookies whose
// requests say they come from this site, as a browser's do.
func sameSite() *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Transport: sameSiteTransport{}}
}

type sameSiteTransport struct{}

func (sameSiteTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	return http.DefaultTransport.RoundTrip(r)
}

// The configuration file is downloaded whole as a backup and replaced whole by
// a restore. A password kept in it would be handed out by the routes it guards,
// and restoring a backup from before the password would switch it off.
func TestTheBackupNeitherCarriesNorRemovesThePassword(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	h := newHarness(t)
	auth := web.OpenSignIn(t, h.dir, testKey, "")
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, SignIn: auth, Key: testKey})
	before, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatal(err)
	}

	c := sameSite()
	req, _ := http.NewRequest(http.MethodPut, srv.URL+signin.APIPrefix+"me/password", strings.NewReader(`{"next":"a long enough passphrase"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("setting the password answered %s", resp.Status)
	}

	resp, err = c.Get(srv.URL + "/api/config/raw")
	if err != nil {
		t.Fatal(err)
	}
	backup, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || bytes.Contains(backup, []byte("argon2id")) || bytes.Contains(backup, []byte("passphrase")) {
		t.Fatalf("the backup answered %s and carries the password: %s", resp.Status, backup)
	}

	// The file from before the password existed, put back.
	req, _ = http.NewRequest(http.MethodPut, srv.URL+"/api/config/raw", bytes.NewReader(before))
	req.Header.Set("Content-Type", "application/json")
	resp, err = c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("the restore answered %s", resp.Status)
	}

	stranger, err := http.Get(srv.URL + "/api/jobs")
	if err != nil {
		t.Fatal(err)
	}
	stranger.Body.Close()
	if stranger.StatusCode != http.StatusUnauthorized {
		t.Errorf("after restoring an old backup a stranger gets %s, so the password is gone", stranger.Status)
	}
}

// testHash hashes at the cheapest cost bcrypt allows, as a hash someone put
// into ARROWLOOP_PASSWORD_HASH may be.
func testHash(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return string(h)
}
