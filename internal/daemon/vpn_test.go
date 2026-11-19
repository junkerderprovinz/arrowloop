package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"golang.org/x/net/webdav"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/vpn"
	"github.com/junkerderprovinz/arrowloop/internal/vpn/vpntest"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// insideOnly is a WebDAV share at the tunnel's server address, which the
// machine's own network does not reach: a NAS at home behind its WireGuard
// server.
const insideOnly = ":webdav,url='http://10.2.0.1/',vendor=other:"

type vpnSetup struct {
	r      *Runner
	vpn    *vpnconn.Manager
	srv    *vpntest.Server
	left   string
	shared string
}

// newVPNRunner has two jobs from the same folder to the share, one through
// the VPN and one not.
func newVPNRunner(t *testing.T, tune ...func(*vpnconn.Options)) *vpnSetup {
	t.Helper()
	root := t.TempDir()
	s := &vpnSetup{left: filepath.Join(root, "left"), shared: filepath.Join(root, "share")}
	for _, d := range []string{s.left, s.shared} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	invoice := filepath.Join(s.left, "invoice.pdf")
	if err := os.WriteFile(invoice, []byte("paid"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Older than the quiet period, which leaves a file just written for later.
	an := time.Now().Add(-time.Hour)
	if err := os.Chtimes(invoice, an, an); err != nil {
		t.Fatal(err)
	}
	s.srv = vpntest.Start(t, &webdav.Handler{FileSystem: webdav.Dir(s.shared), LockSystem: webdav.NewMemLS()})

	opts := vpnconn.Options{
		Dir:            root,
		Key:            setupKey,
		Logf:           t.Logf,
		ConnectTimeout: 5 * time.Second,
		HoldFor:        time.Second,
		Tunnel:         vpn.Options{Poll: 50 * time.Millisecond},
	}
	for _, f := range tune {
		f(&opts)
	}
	m, err := vpnconn.New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	if _, _, err := m.Add(vpnconn.Custom, map[string]string{"config": s.srv.Config()}); err != nil {
		t.Fatal(err)
	}
	s.vpn = m

	hist, err := history.Open(context.Background(), filepath.Join(root, "history.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { hist.Close() })
	cfg := &job.Config{
		Jobs: []job.Job{
			{Name: "through", Left: s.left, Right: insideOnly, State: filepath.Join(root, "through.db"), VPN: vpnconn.Custom},
			{Name: "direct", Left: s.left, Right: insideOnly, State: filepath.Join(root, "direct.db")},
		},
		ParallelJobs: 2,
	}
	s.r = New(cfg, hist, t.Logf)
	s.r.SetVPN(m)
	return s
}

// tunnel is where the setup's tunnel stands.
func (s *vpnSetup) tunnel(t *testing.T) vpnconn.TunnelState {
	t.Helper()
	st := s.vpn.State()
	if len(st.Tunnels) != 1 {
		t.Fatalf("%d tunnels", len(st.Tunnels))
	}
	return st.Tunnels[0]
}

// quickConnect keeps a run that dials an address nothing answers from
// waiting for the system's long timeout.
func quickConnect(t *testing.T) {
	ci := rclonefs.GetConfig(context.Background())
	was := ci.ConnectTimeout
	ci.ConnectTimeout = rclonefs.Duration(2 * time.Second)
	t.Cleanup(func() { ci.ConnectTimeout = was })
}

func TestAJobThroughTheVPNSyncsWhatOnlyTheTunnelReaches(t *testing.T) {
	s := newVPNRunner(t)
	rec, err := s.r.Run(context.Background(), "through")
	if err != nil {
		t.Fatalf("the run failed: %v (%s)", err, rec.Err)
	}
	got, err := os.ReadFile(filepath.Join(s.shared, "invoice.pdf"))
	if err != nil || string(got) != "paid" {
		t.Fatalf("the share holds %q, %v", got, err)
	}
	if st := s.tunnel(t); st.Status != vpnconn.Down || len(st.Jobs) != 0 {
		t.Errorf("after the run the VPN is %s for %v", st.Status, st.Jobs)
	}
}

func TestAJobWithoutAVPNStaysOffTheTunnel(t *testing.T) {
	quickConnect(t)
	s := newVPNRunner(t)
	done := make(chan error, 1)
	go func() {
		_, err := s.r.Run(context.Background(), "direct")
		done <- err
	}()
	deadline := time.After(time.Minute)
	for {
		if st := s.tunnel(t); st.Status != vpnconn.Down {
			t.Fatalf("a job without a VPN brought the VPN %s", st.Status)
		}
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("a job without a VPN reached what only the tunnel reaches")
			}
			if _, err := os.Stat(filepath.Join(s.shared, "invoice.pdf")); err == nil {
				t.Error("the file arrived without the tunnel")
			}
			return
		case <-deadline:
			t.Fatal("the run did not end")
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestATunnelThatDoesNotComeUpFailsTheRunAndSyncsNothing(t *testing.T) {
	s := newVPNRunner(t, func(o *vpnconn.Options) { o.ConnectTimeout = 700 * time.Millisecond })
	s.srv.Close()
	rec, err := s.r.Run(context.Background(), "through")
	if !errors.Is(err, ErrVPNDown) {
		t.Fatalf("the run ended with %v, want ErrVPNDown", err)
	}
	if !strings.Contains(rec.Err, "the VPN did not come up") || !strings.Contains(rec.Err, "no handshake") {
		t.Errorf("the run log says %q", rec.Err)
	}
	if entries, _ := os.ReadDir(s.shared); len(entries) != 0 {
		t.Errorf("the share got %d entries", len(entries))
	}
}

func TestAJobThroughTheVPNFailsWhereThereIsNone(t *testing.T) {
	s := newVPNRunner(t)
	s.r.SetVPN(nil)
	if _, err := s.r.Run(context.Background(), "through"); !errors.Is(err, ErrNoVPN) {
		t.Fatalf("the run ended with %v, want ErrNoVPN", err)
	}
}

func TestASideTheVPNCannotCarryRefusesTheRun(t *testing.T) {
	s := newVPNRunner(t)
	cfg := s.r.Config()
	cfg.Jobs[0].Right = ":smb,host=192.0.2.20:share"
	_, err := s.r.Run(context.Background(), "through")
	if !errors.Is(err, ErrVPNRefused) || !strings.Contains(err.Error(), "right side") || !strings.Contains(err.Error(), "smb") {
		t.Fatalf("the run ended with %v", err)
	}
	if st := s.tunnel(t); st.Status != vpnconn.Down {
		t.Errorf("a refused run brought the VPN %s", st.Status)
	}
}

func TestAJobWhoseTunnelWasRemovedFailsRatherThanGoingDirect(t *testing.T) {
	s := newVPNRunner(t)
	if _, err := s.vpn.Forget(vpnconn.Custom); err != nil {
		t.Fatal(err)
	}
	rec, err := s.r.Run(context.Background(), "through")
	if !errors.Is(err, ErrVPNDown) || !errors.Is(err, vpnconn.ErrNotSetUp) {
		t.Fatalf("the run ended with %v (%s)", err, rec.Err)
	}
	if entries, _ := os.ReadDir(s.shared); len(entries) != 0 {
		t.Errorf("the share got %d entries", len(entries))
	}
}

func TestJobsOfTheSingleVPNMoveToItsTunnel(t *testing.T) {
	s := newVPNRunner(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "arrowloop.json")
	body := `{"jobs":[
		{"name":"through","left":` + quote(s.left) + `,"right":` + quote(insideOnly) + `,"state":"through.db","vpn":true},
		{"name":"direct","left":` + quote(s.left) + `,"right":` + quote(insideOnly) + `,"state":"direct.db"}
	]}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := job.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if j, _ := cfg.Find("through"); j.VPN != job.FormerVPN {
		t.Fatalf("the older switch reads as %q", j.VPN)
	}
	older, _ := json.Marshal(map[string]any{"provider": vpnconn.Custom, "logins": map[string]string{vpnconn.Custom: sealedLogin(t, s.srv.Config())}})
	if err := os.WriteFile(filepath.Join(dir, vpnconn.FileName), older, 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := vpnconn.New(vpnconn.Options{Dir: dir, Key: setupKey, Logf: t.Logf, ConnectTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)

	s.r.Reload(cfg)
	s.r.SetVPN(m)
	if j, _ := s.r.Config().Find("through"); j.VPN != vpnconn.Custom {
		t.Errorf("the job goes through %q, want the tunnel that was in use", j.VPN)
	}
	if j, _ := s.r.Config().Find("direct"); j.VPN != "" {
		t.Errorf("a job without the switch goes through %q", j.VPN)
	}
	saved, err := job.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if j, _ := saved.Find("through"); j.VPN != vpnconn.Custom {
		t.Errorf("the file says %q", j.VPN)
	}
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

var setupKey = bytes.Repeat([]byte{3}, 32)

func sealedLogin(t *testing.T, config string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"config": config})
	sealed, err := security.Seal(setupKey, string(b))
	if err != nil {
		t.Fatal(err)
	}
	return sealed
}

func TestALookNobodyAskedForLeavesTheTunnelDown(t *testing.T) {
	s := newVPNRunner(t)
	j, _ := s.r.Config().Find("through")
	if _, _, err := s.r.JoinVPN(context.Background(), j); !errors.Is(err, vpnconn.ErrNotUp) {
		t.Fatalf("join = %v, want ErrNotUp", err)
	}
	if st := s.tunnel(t); st.Status != vpnconn.Down {
		t.Errorf("the look brought the VPN %s", st.Status)
	}
	direct, _ := s.r.Config().Find("direct")
	if _, done, err := s.r.JoinVPN(context.Background(), direct); err != nil {
		t.Errorf("a job without a VPN = %v", err)
	} else {
		done()
	}
}

func TestTheConflictListLeavesAVPNJobUncheckedUnlessAsked(t *testing.T) {
	quickConnect(t)
	s := newVPNRunner(t)
	for i := range s.r.Config().Jobs {
		s.r.Config().Jobs[i].Direction = "both"
	}
	_, unread := s.r.Conflicts(context.Background(), "", false)
	var through error
	for _, u := range unread {
		if u.Job == "through" {
			through = u.Err
		}
	}
	if !errors.Is(through, vpnconn.ErrNotUp) {
		t.Errorf("the job through the VPN = %v, want ErrNotUp", through)
	}
	if st := s.tunnel(t); st.Status != vpnconn.Down {
		t.Errorf("the list brought the VPN %s", st.Status)
	}

	_, unread = s.r.Conflicts(context.Background(), "through", true)
	if len(unread) != 0 {
		t.Errorf("asked for, the job is unread: %v", unread[0].Err)
	}
}

func TestAPreviewOfAJobThroughTheVPNGoesThroughItsTunnel(t *testing.T) {
	quickConnect(t)
	s := newVPNRunner(t)
	if _, err := s.r.Preview(context.Background(), "through"); err != nil {
		t.Fatalf("the preview did not reach what only the tunnel reaches: %v", err)
	}
	if st := s.tunnel(t); st.Status != vpnconn.Down {
		t.Errorf("after the preview the VPN is %s", st.Status)
	}
}
