package web_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// withVPN stands a server up on the harness's engine with the built-in VPN.
func withVPN(t *testing.T, h *harness) (*vpnconn.Manager, string) {
	t.Helper()
	// The endpoints here answer nobody, so a tunnel gives up soon.
	m, err := vpnconn.New(vpnconn.Options{Dir: h.dir, Key: bytes.Repeat([]byte{5}, 32), ConnectTimeout: 500 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	h.runner.SetVPN(m)
	srv := newServer(t, &web.Server{History: h.history, Runner: h.runner, VPN: m})
	return m, srv.URL
}

const ownConfig = `[Interface]
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
Address = 10.64.12.3/32

[Peer]
PublicKey = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
AllowedIPs = 0.0.0.0/0
Endpoint = 203.0.113.9:51820
`

func TestTheVPNSettingsNeverShowALogin(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	body, _ := json.Marshal(map[string]any{"fields": map[string]string{"config": ownConfig}})
	req, _ := http.NewRequest(http.MethodPut, base+"/api/vpn/custom", bytes.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("saving the own config answered %s", resp.Status)
	}

	resp, err = http.Get(base + "/api/vpn")
	if err != nil {
		t.Fatal(err)
	}
	var raw bytes.Buffer
	raw.ReadFrom(resp.Body)
	resp.Body.Close()
	if strings.Contains(raw.String(), "yAnz5TF") || strings.Contains(raw.String(), "PrivateKey") {
		t.Errorf("the settings show the login: %s", raw.String())
	}
	var st vpnconn.State
	if err := json.Unmarshal(raw.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Provider != vpnconn.Custom || st.Status != vpnconn.Down {
		t.Errorf("provider %q, status %s", st.Provider, st.Status)
	}
}

func TestABrokenConfigIsRefusedWithItsCode(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	body := `{"fields":{"config":"[Interface]\nPrivateKey = nope\n"}}`
	req, _ := http.NewRequest(http.MethodPut, base+"/api/vpn/custom", strings.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusBadRequest || out["code"] != vpnconn.CodeConfigInvalid || out["field"] != "config" {
		t.Errorf("answered %s %v", resp.Status, out)
	}
}

func TestOnlyAnEngineWithAVPNOffersIt(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	var caps map[string]any
	resp, err := http.Get(base + "/api/capabilities")
	if err != nil {
		t.Fatal(err)
	}
	json.NewDecoder(resp.Body).Decode(&caps)
	resp.Body.Close()
	if caps["vpn"] != true {
		t.Errorf("capabilities %v, want vpn", caps)
	}

	phone := newServer(t, &web.Server{History: h.history, Runner: h.runner})
	resp, err = http.Get(phone.URL + "/api/vpn")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("an engine without a VPN answered %s", resp.Status)
	}
}

func TestAJobsCheckFailsWhenItsTunnelDoesNotComeUp(t *testing.T) {
	h := engineFor(t, `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","vpn":true}]}`)
	m, base := withVPN(t, h)
	if _, err := m.Save(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(base + "/api/jobs/photos/verify")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusBadGateway || !strings.Contains(out["error"], "the VPN did not come up") {
		t.Errorf("answered %s %v", resp.Status, out)
	}
}
