package daemon

import (
	"bytes"
	"context"
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
		Key:            bytes.Repeat([]byte{3}, 32),
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
	if _, err := m.Save(vpnconn.Custom, map[string]string{"config": s.srv.Config()}); err != nil {
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
			{Name: "through", Left: s.left, Right: insideOnly, State: filepath.Join(root, "through.db"), VPN: true},
			{Name: "direct", Left: s.left, Right: insideOnly, State: filepath.Join(root, "direct.db")},
		},
		ParallelJobs: 2,
	}
	s.r = New(cfg, hist, t.Logf)
	s.r.SetVPN(m)
	return s
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
	if st := s.vpn.State(); st.Status != vpnconn.Down || len(st.Jobs) != 0 {
		t.Errorf("after the run the VPN is %s for %v", st.Status, st.Jobs)
	}
}

func TestAJobWithoutTheSwitchStaysOffTheTunnel(t *testing.T) {
	quickConnect(t)
	s := newVPNRunner(t)
	done := make(chan error, 1)
	go func() {
		_, err := s.r.Run(context.Background(), "direct")
		done <- err
	}()
	deadline := time.After(time.Minute)
	for {
		if st := s.vpn.State(); st.Status != vpnconn.Down {
			t.Fatalf("a job without the switch brought the VPN %s", st.Status)
		}
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("a job without the switch reached what only the tunnel reaches")
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
	if st := s.vpn.State(); st.Status != vpnconn.Down {
		t.Errorf("a refused run brought the VPN %s", st.Status)
	}
}
