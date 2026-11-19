package vpnconn

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rclone/rclone/fs/fshttp"

	"github.com/junkerderprovinz/arrowloop/internal/vpn"
	"github.com/junkerderprovinz/arrowloop/internal/vpn/vpntest"
)

// insideOnly answers only inside the tunnel, the way a NAS at home behind a
// WireGuard server does.
var insideOnly = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	io.WriteString(w, "inside "+r.URL.Path)
})

func newManager(t *testing.T, tune ...func(*Options)) *Manager {
	t.Helper()
	opts := Options{
		Dir:            t.TempDir(),
		Key:            bytes.Repeat([]byte{7}, 32),
		Logf:           t.Logf,
		ConnectTimeout: 10 * time.Second,
		HoldFor:        time.Second,
		Tunnel:         vpn.Options{Poll: 50 * time.Millisecond},
	}
	for _, f := range tune {
		f(&opts)
	}
	m, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}

// withOwnConfig is a manager whose own WireGuard config reaches srv.
func withOwnConfig(t *testing.T, srv *vpntest.Server, tune ...func(*Options)) *Manager {
	t.Helper()
	m := newManager(t, tune...)
	if _, err := m.Save(Custom, map[string]string{"config": srv.Config()}); err != nil {
		t.Fatal(err)
	}
	return m
}

func ctxFor(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// fetch asks for address through the proxy, as a run's rclone does.
func fetch(t *testing.T, proxy, address string) (string, error) {
	t.Helper()
	via, err := url.Parse(proxy)
	if err != nil {
		t.Fatal(err)
	}
	tr := &http.Transport{Proxy: http.ProxyURL(via)}
	defer tr.CloseIdleConnections()
	req, _ := http.NewRequestWithContext(ctxFor(t), http.MethodGet, address, nil)
	resp, err := (&http.Client{Transport: tr, Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return string(b), errors.New(resp.Status)
	}
	return string(b), nil
}

func TestARunReachesWhatOnlyTheTunnelReaches(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv)
	if st := m.State(); st.Status != Down || st.Provider != Custom {
		t.Fatalf("before any run: %s, provider %q", st.Status, st.Provider)
	}

	lease, err := m.Acquire(ctxFor(t), "photos")
	if err != nil {
		t.Fatal(err)
	}
	if st := m.State(); st.Status != Connected || len(st.Jobs) != 1 || st.Jobs[0] != "photos" {
		t.Errorf("during the run: %s, jobs %v", st.Status, st.Jobs)
	}
	got, err := fetch(t, lease.Proxy(), "http://10.2.0.1/report")
	if err != nil || got != "inside /report" {
		t.Errorf("plain HTTP through the tunnel = %q, %v", got, err)
	}

	// rclone's own client, built from the run's settings as a backend's is.
	resp, err := fshttp.NewClient(lease.Context(ctxFor(t))).Get("http://10.2.0.1/rclone")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "inside /rclone" {
		t.Errorf("rclone's client got %q", b)
	}

	lease.Release()
	if st := m.State(); st.Status != Down || len(st.Jobs) != 0 {
		t.Errorf("after the run: %s, jobs %v", st.Status, st.Jobs)
	}
	if ts := m.tun.State(); ts.Status != vpn.Disconnected {
		t.Errorf("the tunnel is %s with no run left", ts.Status)
	}
	if _, err := fetch(t, lease.Proxy(), "http://10.2.0.1/late"); err == nil {
		t.Error("the proxy of a finished run still carries traffic")
	}
}

func TestTheTunnelStaysUpUntilTheLastRunLetsGo(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv)
	photos, err := m.Acquire(ctxFor(t), "photos")
	if err != nil {
		t.Fatal(err)
	}
	music, err := m.Acquire(ctxFor(t), "music")
	if err != nil {
		t.Fatal(err)
	}
	if photos.Proxy() != music.Proxy() {
		t.Error("two runs at once brought up two tunnels")
	}
	photos.Release()
	photos.Release()
	if st := m.State(); st.Status != Connected || strings.Join(st.Jobs, ",") != "music" {
		t.Fatalf("with one run left: %s, jobs %v", st.Status, st.Jobs)
	}
	if got, err := fetch(t, music.Proxy(), "http://10.2.0.1/still"); err != nil || got != "inside /still" {
		t.Errorf("the remaining run lost its tunnel: %q, %v", got, err)
	}
	music.Release()
	if st := m.State(); st.Status != Down {
		t.Errorf("after both runs: %s", st.Status)
	}

	again, err := m.Acquire(ctxFor(t), "photos")
	if err != nil {
		t.Fatalf("the next run cannot bring the tunnel up again: %v", err)
	}
	defer again.Release()
	if got, err := fetch(t, again.Proxy(), "http://10.2.0.1/next"); err != nil || got != "inside /next" {
		t.Errorf("the next run: %q, %v", got, err)
	}
}

func TestATunnelThatDoesNotComeUpFailsTheRun(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv, func(o *Options) { o.ConnectTimeout = 700 * time.Millisecond })
	srv.Close()

	_, err := m.Acquire(ctxFor(t), "photos")
	if err == nil || !strings.Contains(err.Error(), "no handshake") {
		t.Fatalf("acquire = %v, want no handshake", err)
	}
	st := m.State()
	if st.Status != Failed || st.ErrorCode != CodeTimeout || len(st.Jobs) != 0 {
		t.Errorf("state %s %q, jobs %v", st.Status, st.ErrorCode, st.Jobs)
	}
	if ts := m.tun.State(); ts.Status != vpn.Disconnected {
		t.Errorf("the tunnel is left %s", ts.Status)
	}
}

func TestAnEndpointWhoseNameDoesNotResolveSaysSo(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := newManager(t, func(o *Options) {
		o.Tunnel.LookupNetIP = func(context.Context, string, string) ([]netip.Addr, error) {
			return nil, &net.DNSError{Err: "no such host", Name: "vpn.example.net", IsNotFound: true}
		}
	})
	conf := strings.Replace(srv.Config(), "Endpoint = 127.0.0.1:", "Endpoint = vpn.example.net:", 1)
	if _, err := m.Save(Custom, map[string]string{"config": conf}); err != nil {
		t.Fatal(err)
	}

	if _, err := m.Acquire(ctxFor(t), "photos"); err == nil {
		t.Fatal("a run came up on an endpoint that does not resolve")
	}
	if st := m.State(); st.Status != Failed || st.ErrorCode != CodeNameUnresolved {
		t.Errorf("state %s %q, want %q", st.Status, st.ErrorCode, CodeNameUnresolved)
	}
}

func TestARunWithoutAVPNSetUpIsRefused(t *testing.T) {
	m := newManager(t)
	if _, err := m.Acquire(ctxFor(t), "photos"); !errors.Is(err, ErrNotSetUp) {
		t.Errorf("acquire = %v, want ErrNotSetUp", err)
	}
}

func TestTheProxyCarriesNothingPastTheTunnel(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv)
	lease, err := m.Acquire(ctxFor(t), "photos")
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()

	// A server on this machine, which the machine's own network reaches and
	// the tunnel does not.
	outside := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("a request reached %s past the tunnel", r.URL)
	}))
	defer outside.Close()
	if _, err := fetch(t, lease.Proxy(), outside.URL+"/plain"); err == nil {
		t.Error("plain HTTP reached a server outside the tunnel")
	}
	if _, err := fetch(t, lease.Proxy(), strings.Replace(outside.URL, "http:", "https:", 1)+"/tls"); err == nil {
		t.Error("a CONNECT reached a server outside the tunnel")
	}

	// With the tunnel gone in the middle of the run, connections wait for it
	// and then fail.
	srv.Close()
	m.tun.Disconnect()
	if _, err := fetch(t, lease.Proxy(), "http://10.2.0.1/down"); err == nil {
		t.Error("a request went through with the tunnel down")
	}
}

func TestTheProxyTakesOnlyItsOwnRuns(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv)
	lease, err := m.Acquire(ctxFor(t), "photos")
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Release()
	u, _ := url.Parse(lease.Proxy())
	u.User = url.User("guess")
	if _, err := fetch(t, u.String(), "http://10.2.0.1/"); err == nil || !strings.Contains(err.Error(), "407") {
		t.Errorf("a wrong key = %v, want 407", err)
	}
	u.User = nil
	if _, err := fetch(t, u.String(), "http://10.2.0.1/"); err == nil || !strings.Contains(err.Error(), "407") {
		t.Errorf("no key = %v, want 407", err)
	}
}

func TestAStoppedRunLetsGoOfATunnelStillComingUp(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv, func(o *Options) { o.ConnectTimeout = 5 * time.Second })
	srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(200 * time.Millisecond)
		cancel()
	}()
	if _, err := m.Acquire(ctx, "photos"); !errors.Is(err, context.Canceled) {
		t.Fatalf("acquire = %v, want the stop", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for m.tun.State().Status != vpn.Disconnected {
		if time.Now().After(deadline) {
			t.Fatal("the tunnel of a stopped run stays")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestALoginIsSealedAndNeverShown(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv)
	key := srv.ClientKey.String()
	raw, err := os.ReadFile(filepath.Join(m.opts.Dir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(key)) || !bytes.Contains(raw, []byte("sealed:")) {
		t.Errorf("%s holds the private key in clear:\n%s", FileName, raw)
	}
	if info, _ := os.Stat(filepath.Join(m.opts.Dir, FileName)); info != nil && info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Errorf("%s is readable by others: %v", FileName, info.Mode())
	}
	st := m.State()
	for _, p := range st.Providers {
		if p.ID == Custom && !p.Configured {
			t.Error("the own config does not show as saved")
		}
	}

	reopened, err := New(m.opts)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	lease, err := reopened.Acquire(ctxFor(t), "photos")
	if err != nil {
		t.Fatalf("the sealed login does not open after a restart: %v", err)
	}
	lease.Release()

	other := m.opts
	other.Key = bytes.Repeat([]byte{8}, 32)
	wrong, err := New(other)
	if err != nil {
		t.Fatal(err)
	}
	defer wrong.Close()
	if _, err := wrong.Acquire(ctxFor(t), "photos"); err == nil {
		t.Error("a login sealed under another key connected")
	}
}

func TestSavingRefusesWhatCannotConnect(t *testing.T) {
	m := newManager(t)
	var ref *Refusal
	if _, err := m.Save(Custom, map[string]string{"config": "[Interface]\nPrivateKey = nope\n"}); !errors.As(err, &ref) || ref.Code != CodeConfigInvalid || ref.Field != "config" {
		t.Errorf("a broken config = %v", err)
	}
	if _, err := m.Save(Custom, map[string]string{}); !errors.As(err, &ref) || ref.Code != "vpn-field-missing" {
		t.Errorf("no config = %v", err)
	}
	if _, err := m.Save("nordvpn", map[string]string{"password": "x"}); !errors.As(err, &ref) || ref.Code != "vpn-field-unknown" {
		t.Errorf("a field the provider has none of = %v", err)
	}
	if _, err := m.Save("elsewhere", nil); !errors.As(err, &ref) || ref.Status != http.StatusNotFound {
		t.Errorf("an unknown provider = %v", err)
	}
	if st := m.State(); st.Provider != "" {
		t.Errorf("a refused save chose %q", st.Provider)
	}
}

func TestForgettingTheProviderInUseLeavesNoneSetUp(t *testing.T) {
	srv := vpntest.Start(t, insideOnly)
	m := withOwnConfig(t, srv)
	st, err := m.Forget(Custom)
	if err != nil {
		t.Fatal(err)
	}
	if st.Provider != "" {
		t.Errorf("provider %q after forgetting it", st.Provider)
	}
	if _, err := m.Acquire(ctxFor(t), "photos"); !errors.Is(err, ErrNotSetUp) {
		t.Errorf("acquire after forgetting = %v", err)
	}
}

func TestTheTestFindsTheExitAddress(t *testing.T) {
	srv := vpntest.Start(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "203.0.113.7")
	}))
	m := withOwnConfig(t, srv, func(o *Options) { o.ExitIPURL = "http://10.2.0.1/ip" })
	st, err := m.Test(ctxFor(t))
	if err != nil {
		t.Fatal(err)
	}
	if st.ExitIP != "203.0.113.7" || st.Status != Down {
		t.Errorf("after the test: exit %q, %s", st.ExitIP, st.Status)
	}
}

func TestTheCatalogueIsTheTilesList(t *testing.T) {
	web, err := os.ReadFile(filepath.Join("..", "..", "web", "src", "lib", "vpn.ts"))
	if err != nil {
		t.Fatal(err)
	}
	at := 0
	for _, p := range catalogue() {
		i := bytes.Index(web[at:], []byte("id: '"+p.ID+"'"))
		if i < 0 {
			t.Errorf("%s is not in web/src/lib/vpn.ts after the one before it", p.ID)
			continue
		}
		at += i
	}
}
