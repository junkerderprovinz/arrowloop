package web_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/rclone/rclone/backend/webdav"
	rclonefs "github.com/rclone/rclone/fs"
	"golang.org/x/net/webdav"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/vpn"
	"github.com/junkerderprovinz/arrowloop/internal/vpn/vpntest"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// behindTunnel is an engine with the target "nas", a WebDAV share only a
// WireGuard tunnel reaches, and a job on it that goes through that tunnel.
func behindTunnel(t *testing.T) (*httptest.Server, *vpnconn.Manager) {
	t.Helper()
	withRcloneConfig(t)
	shared := t.TempDir()
	if err := os.MkdirAll(filepath.Join(shared, "photos"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := vpntest.Start(t, &webdav.Handler{FileSystem: webdav.Dir(shared), LockSystem: webdav.NewMemLS()})
	if err := remotes.Save("nas", "webdav", map[string]string{"url": "http://" + vpntest.ServerAddr.String() + "/", "vendor": "other"}); err != nil {
		t.Fatal(err)
	}
	// A dial past the tunnel goes to an address nothing answers on.
	ci := rclonefs.GetConfig(context.Background())
	was := ci.ConnectTimeout
	ci.ConnectTimeout = rclonefs.Duration(2 * time.Second)
	t.Cleanup(func() { ci.ConnectTimeout = was })

	h := engineFor(t, `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"nas:photos","state":"%[1]s/photos.db","quietPeriod":"0s","vpn":"custom"}]}`)
	m, err := vpnconn.New(vpnconn.Options{
		Dir: h.dir, Key: bytes.Repeat([]byte{5}, 32), Logf: t.Logf,
		ConnectTimeout: 5 * time.Second, HoldFor: time.Second,
		Tunnel: vpn.Options{Poll: 50 * time.Millisecond},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": srv.Config()}); err != nil {
		t.Fatal(err)
	}
	h.runner.SetVPN(m)
	return newServer(t, &web.Server{History: h.history, Runner: h.runner, VPN: m}), m
}

type checkAnswer struct {
	OK        bool   `json:"ok"`
	Reason    string `json:"reason"`
	Unchecked bool   `json:"unchecked"`
}

func postCheck(t *testing.T, srv *httptest.Server, path string, body any) checkAnswer {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		json.NewEncoder(&payload).Encode(body)
	}
	resp, err := srv.Client().Post(srv.URL+path, "application/json", &payload)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out checkAnswer
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("%s answered %s: %v", path, resp.Status, err)
	}
	return out
}

func TestACheckSomebodyAskedForReachesATargetThroughItsJobsVPN(t *testing.T) {
	srv, _ := behindTunnel(t)
	if got := postCheck(t, srv, "/api/remotes/nas/check?connect=1", nil); !got.OK {
		t.Errorf("check %+v, want the share reached through the tunnel", got)
	}
}

func TestACheckNobodyAskedForLeavesTheTunnelDownAndSaysSo(t *testing.T) {
	srv, m := behindTunnel(t)
	got := postCheck(t, srv, "/api/remotes/nas/check", nil)
	if got.OK || !got.Unchecked {
		t.Errorf("check %+v, want it left unchecked rather than tried past the tunnel", got)
	}
	if st := tunnelStatus(t, m); st != vpnconn.Down {
		t.Errorf("the tunnel is %s, want it left down", st)
	}
}

func TestTestingASavedTargetsFormGoesThroughItsJobsVPN(t *testing.T) {
	srv, _ := behindTunnel(t)
	got := postCheck(t, srv, "/api/remotes-check", map[string]any{
		"name": "nas", "type": "webdav",
		"settings": map[string]string{"url": "http://" + vpntest.ServerAddr.String() + "/", "vendor": "other"},
	})
	if !got.OK {
		t.Errorf("test %+v, want the share reached through the tunnel", got)
	}
}

func TestTheFolderPickerListsATargetThroughItsJobsVPN(t *testing.T) {
	srv, _ := behindTunnel(t)
	resp, err := srv.Client().Get(srv.URL + "/api/browse?path=" + url.QueryEscape("nas:"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Entries []struct{ Name string } `json:"entries"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusOK || len(out.Entries) != 1 || out.Entries[0].Name != "photos" {
		t.Errorf("browse answered %s %+v, want the share's folder", resp.Status, out)
	}
}
