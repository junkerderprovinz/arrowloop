package web_test

import (
	"bytes"
	"encoding/json"
	"fmt"
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

// addTunnel sets a tunnel of provider up through the API and returns its id.
func addTunnel(t *testing.T, base, provider string, fields map[string]string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"provider": provider, "fields": fields})
	resp, err := http.Post(base+"/api/vpn", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		ID    string        `json:"id"`
		State vpnconn.State `json:"state"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusOK || out.ID == "" {
		t.Fatalf("adding a %s tunnel answered %s %+v", provider, resp.Status, out)
	}
	return out.ID
}

func TestTheVPNSettingsNeverShowALogin(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	addTunnel(t, base, vpnconn.Custom, map[string]string{"config": ownConfig})

	resp, err := http.Get(base + "/api/vpn")
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
	if len(st.Tunnels) != 1 || st.Tunnels[0].Provider != vpnconn.Custom || st.Tunnels[0].Status != vpnconn.Down || st.Tunnels[0].Place != "203.0.113.9" {
		t.Errorf("tunnels %+v", st.Tunnels)
	}
}

func TestASecondTunnelIsChangedTestedAndRemovedOnItsOwn(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	first := addTunnel(t, base, vpnconn.Custom, map[string]string{"config": ownConfig})
	second := addTunnel(t, base, vpnconn.Custom, map[string]string{"config": strings.Replace(ownConfig, "203.0.113.9", "203.0.113.10", 1)})
	if first == second {
		t.Fatalf("both tunnels are %q", first)
	}

	resp, err := http.Post(base+"/api/vpn/"+second+"/test", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	var tested struct {
		OK    bool          `json:"ok"`
		State vpnconn.State `json:"state"`
	}
	json.NewDecoder(resp.Body).Decode(&tested)
	resp.Body.Close()
	failed := map[string]vpnconn.Status{}
	for _, ts := range tested.State.Tunnels {
		failed[ts.ID] = ts.Status
	}
	if tested.OK || failed[second] != vpnconn.Failed || failed[first] != vpnconn.Down {
		t.Errorf("after testing %s: ok %v, %v", second, tested.OK, failed)
	}

	req, _ := http.NewRequest(http.MethodDelete, base+"/api/vpn/"+first, nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var left vpnconn.State
	json.NewDecoder(resp.Body).Decode(&left)
	resp.Body.Close()
	if len(left.Tunnels) != 1 || left.Tunnels[0].ID != second {
		t.Errorf("after removing %s: %+v", first, left.Tunnels)
	}
}

func TestABrokenConfigIsRefusedWithItsCode(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	body := `{"provider":"custom","fields":{"config":"[Interface]\nPrivateKey = nope\n"}}`
	resp, err := http.Post(base+"/api/vpn", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Code   string            `json:"code"`
		Values map[string]string `json:"values"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != http.StatusBadRequest || out.Code != vpnconn.CodeConfigInvalid || out.Values["field"] != "config" {
		t.Errorf("answered %s %v", resp.Status, out)
	}
}

func TestARefusedConfigNamesTheLineThatDoesNotFit(t *testing.T) {
	h := newHarness(t)
	_, base := withVPN(t, h)
	body := `{"provider":"custom","fields":{"config":"[Interface]\n\nAdress 10.0.0.2/32\n"}}`
	resp, err := http.Post(base+"/api/vpn", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Values map[string]string `json:"values"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if out.Values["line"] != "3" || out.Values["text"] != "Adress 10.0.0.2/32" {
		t.Errorf("answered %s %v", resp.Status, out.Values)
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

	bare := newServer(t, &web.Server{History: h.history, Runner: h.runner})
	resp, err = http.Get(bare.URL + "/api/vpn")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("an engine without a VPN answered %s", resp.Status)
	}
}

func TestAJobsCheckFailsWhenItsTunnelDoesNotComeUp(t *testing.T) {
	h := engineFor(t, `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","vpn":"custom"}]}`)
	m, base := withVPN(t, h)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
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

// trashOfVPNJob is a job whose right side only the tunnel would reach, behind
// an own config whose server answers nobody, so a tunnel that is brought up
// fails and shows as failed.
const trashOfVPNJob = `{"jobs":[{"name":"photos","left":"%[1]s/left","right":":webdav,url='http://10.2.0.1/',vendor=other:","state":"%[1]s/photos.db","vpn":"custom"}]}`

func tunnelStatus(t *testing.T, m *vpnconn.Manager) vpnconn.Status {
	t.Helper()
	st := m.State()
	if len(st.Tunnels) != 1 {
		t.Fatalf("%d tunnels", len(st.Tunnels))
	}
	return st.Tunnels[0].Status
}

func TestTheTrashOfEveryJobLeavesATunnelThatIsDownAlone(t *testing.T) {
	h := engineFor(t, trashOfVPNJob)
	m, base := withVPN(t, h)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/trash", "/api/trash?job=photos"} {
		resp, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		var out struct {
			Sides []struct {
				Side      string `json:"side"`
				Error     string `json:"error"`
				Unchecked bool   `json:"unchecked"`
			} `json:"sides"`
		}
		json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		got := map[string]string{}
		for _, s := range out.Sides {
			got[s.Side] = fmt.Sprintf("unchecked=%v error=%q", s.Unchecked, s.Error)
		}
		if got["left"] != `unchecked=false error=""` || got["right"] != `unchecked=true error=""` {
			t.Errorf("%s: %v", path, got)
		}
	}
	if st := tunnelStatus(t, m); st != vpnconn.Down {
		t.Errorf("the listing brought the tunnel up: %s", st)
	}
}

func TestAJobsOwnTrashBringsItsTunnelUp(t *testing.T) {
	for _, path := range []string{"/api/jobs/photos/trash/right", "/api/trash?job=photos&connect=1"} {
		h := engineFor(t, trashOfVPNJob)
		m, base := withVPN(t, h)
		if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
			t.Fatal(err)
		}
		resp, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if st := tunnelStatus(t, m); st != vpnconn.Failed {
			t.Errorf("%s left the tunnel %s, want it tried", path, st)
		}
	}
}

func TestTheConflictsOfEveryJobLeaveATunnelThatIsDownAlone(t *testing.T) {
	h := engineFor(t, trashOfVPNJob)
	m, base := withVPN(t, h)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(base + "/api/conflicts")
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Unread []struct {
			Job       string `json:"job"`
			Unchecked bool   `json:"unchecked"`
		} `json:"unread"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	if len(out.Unread) != 1 || out.Unread[0].Job != "photos" || !out.Unread[0].Unchecked {
		t.Errorf("unread %+v", out.Unread)
	}
	if st := tunnelStatus(t, m); st != vpnconn.Down {
		t.Errorf("the list brought the tunnel up: %s", st)
	}
}

func TestAFolderOnThisDeviceIsReadWhenItsJobsTunnelFails(t *testing.T) {
	h := engineFor(t, trashOfVPNJob)
	m, base := withVPN(t, h)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/jobs/photos/trash/left", "/api/jobs/photos/duplicates/left"} {
		resp, err := http.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s answered %s", path, resp.Status)
		}
	}
	if st := tunnelStatus(t, m); st != vpnconn.Down {
		t.Errorf("a folder on this device brought the tunnel up: %s", st)
	}

	resp, err := http.Get(base + "/api/trash?job=photos&connect=1")
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Sides []struct {
			Side  string `json:"side"`
			Error string `json:"error"`
		} `json:"sides"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	resp.Body.Close()
	errs := map[string]string{}
	for _, s := range out.Sides {
		errs[s.Side] = s.Error
	}
	if errs["left"] != "" || !strings.Contains(errs["right"], "the VPN did not come up") {
		t.Errorf("with the tunnel failing: %q", errs)
	}
}

func TestAPrecheckStillChecksTheFolderOnThisDeviceWhenTheTunnelFails(t *testing.T) {
	h := engineFor(t, trashOfVPNJob)
	m, base := withVPN(t, h)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": ownConfig}); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Post(base+"/api/jobs/photos/check?estimate=false", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var rep struct {
		Left     struct{ Free *int64 } `json:"left"`
		Findings []struct {
			Code string            `json:"code"`
			Side string            `json:"side"`
			Vars map[string]string `json:"vars"`
		} `json:"findings"`
	}
	json.NewDecoder(resp.Body).Decode(&rep)
	if resp.StatusCode != http.StatusOK || rep.Left.Free == nil {
		t.Fatalf("answered %s, left %+v", resp.Status, rep.Left)
	}
	var right string
	for _, f := range rep.Findings {
		if f.Code == "sideUnreachable" && f.Side == "left" {
			t.Errorf("the folder on this device is reported unreachable: %v", f.Vars)
		}
		if f.Code == "sideUnreachable" && f.Side == "right" {
			right = f.Vars["error"]
		}
	}
	if !strings.Contains(right, "the VPN did not come up") {
		t.Errorf("the right side says %q", right)
	}
}
