package web_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// The configuration file is downloaded whole as a backup and replaced whole by
// a restore. A password kept in it would be handed out by the routes it guards,
// and restoring a backup from before the password would switch it off.
func TestTheBackupNeitherCarriesNorRemovesThePassword(t *testing.T) {
	t.Setenv(web.PasswordHashEnv, "")
	h := newHarness(t)
	store, err := security.Open(h.configPath)
	if err != nil {
		t.Fatal(err)
	}
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, Security: store})
	before, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatal(err)
	}

	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	resp, err := c.Post(srv.URL+"/api/security/password", "application/json", strings.NewReader(`{"password":"a long enough passphrase"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("setting the password answered %s", resp.Status)
	}
	hash := store.Get().PasswordHash

	resp, err = c.Get(srv.URL + "/api/config/raw")
	if err != nil {
		t.Fatal(err)
	}
	backup, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if bytes.Contains(backup, []byte(hash)) || bytes.Contains(backup, []byte("$2a$")) {
		t.Fatalf("the backup carries the password hash: %s", backup)
	}

	// The file from before the password existed, put back.
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/config/raw", bytes.NewReader(before))
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
