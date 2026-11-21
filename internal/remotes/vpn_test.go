package remotes

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/obscure"

	"github.com/junkerderprovinz/arrowloop/internal/certpin"
	"github.com/junkerderprovinz/arrowloop/internal/vpn/vpntest"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// connectProxy stands in for the tunnel's proxy: it records every CONNECT
// and, with pass set, pipes it on to where it asks.
type connectProxy struct {
	url  string
	pass bool

	mu   sync.Mutex
	seen []string
}

func startConnectProxy(t *testing.T, pass bool) *connectProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	p := &connectProxy{url: "http://run@" + ln.Addr().String(), pass: pass}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go p.handle(c)
		}
	}()
	return p
}

func (p *connectProxy) handle(c net.Conn) {
	defer c.Close()
	in := bufio.NewReader(c)
	req, err := http.ReadRequest(in)
	if err != nil {
		return
	}
	p.mu.Lock()
	p.seen = append(p.seen, req.Method+" "+req.Host)
	p.mu.Unlock()
	if req.Method != http.MethodConnect || !p.pass {
		io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
		return
	}
	server, err := net.DialTimeout("tcp", req.Host, 5*time.Second)
	if err != nil {
		io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
		return
	}
	defer server.Close()
	io.WriteString(c, "HTTP/1.1 200 Connection Established\r\n\r\n")
	go io.Copy(server, in)
	io.Copy(c, server)
}

func (p *connectProxy) asked() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.seen)
}

// throughRun is the context of a run that goes through the VPN behind proxy.
func throughRun(proxy string) context.Context {
	return throughUntil(proxy, nil)
}

// throughUntil is throughRun for a tunnel that goes down when gone closes.
func throughUntil(proxy string, gone <-chan struct{}) context.Context {
	ctx := vpnconn.Through(context.Background(), proxy, gone)
	ctx, ci := rclonefs.AddConfig(ctx)
	ci.HTTPProxy = proxy
	ci.ConnectTimeout = rclonefs.Duration(3 * time.Second)
	ci.LowLevelRetries = 1
	return ctx
}

// pass is a password as a connection string carries it.
var pass = obscure.MustObscure("letmein")

func TestSFTPAndFTPDialThroughTheRunsProxy(t *testing.T) {
	p := startConnectProxy(t, false)
	ctx := throughRun(p.url)
	if _, err := rclonefs.NewFs(ctx, ":sftp,host=192.0.2.10,user=someone,pass="+pass+":"); err == nil {
		t.Fatal("an SFTP server nobody runs answered")
	}
	if _, err := rclonefs.NewFs(ctx, ":ftp,host=192.0.2.11,user=someone,pass="+pass+":"); err == nil {
		t.Fatal("an FTP server nobody runs answered")
	}
	got := p.asked()
	if !slices.Contains(got, "CONNECT 192.0.2.10:22") || !slices.Contains(got, "CONNECT 192.0.2.11:21") {
		t.Errorf("the proxy was asked for %v, want both servers", got)
	}
}

func TestAnSFTPTargetOutsideARunDialsOnItsOwn(t *testing.T) {
	p := startConnectProxy(t, false)
	ctx, ci := rclonefs.AddConfig(context.Background())
	ci.ConnectTimeout = rclonefs.Duration(time.Second)
	rclonefs.NewFs(ctx, ":sftp,host=192.0.2.10,user=someone,pass="+pass+":")
	if got := p.asked(); len(got) != 0 {
		t.Errorf("a target outside any run went through the proxy: %v", got)
	}
}

func TestAHostKeyIsReadThroughTheRunsProxy(t *testing.T) {
	p := startConnectProxy(t, false)
	if _, err := readHostKey(throughRun(p.url), "192.0.2.12", "2222"); err == nil {
		t.Fatal("a host key came from a server nobody runs")
	}
	if got := p.asked(); !slices.Contains(got, "CONNECT 192.0.2.12:2222") {
		t.Errorf("the proxy was asked for %v", got)
	}
}

func TestATrustedCertificateTravelsThroughTheRunsProxy(t *testing.T) {
	ownConfig(t)
	p := startConnectProxy(t, true)
	cert := serverCert(t, nil)
	url := davServer(t, cert)
	form := davForm(url)
	form[CertificateKey] = certpin.Fingerprint(cert.Leaf.Raw)

	if _, err := Try(throughRun(p.url), "", "webdav", form); err != nil {
		t.Fatalf("the trusted certificate was refused through the run's proxy: %v", err)
	}
	host := url[len("https://"):]
	if got := p.asked(); !slices.Contains(got, "CONNECT "+host) {
		t.Errorf("the proxy was asked for %v, want %s", got, host)
	}
}

// nas is a stand-in SMB server on loopback, which hangs up after the first
// request, and the connection string of a share on it.
func nas(t *testing.T) (*vpntest.Hangup, string, string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	return vpntest.HangUp(ln), ln.Addr().String(), ":smb,host=" + host + ",port=" + port + ",user=someone,pass=" + pass + ":share/backup"
}

func TestAnSMBTargetReachesItsServerThroughTheRunsProxy(t *testing.T) {
	server, addr, remote := nas(t)
	p := startConnectProxy(t, true)
	if _, err := rclonefs.NewFs(throughRun(p.url), remote); err == nil {
		t.Fatal("a server that hangs up let the share open")
	}
	if got := p.asked(); !slices.Contains(got, "CONNECT "+addr) {
		t.Errorf("the proxy was asked for %v, want %s", got, addr)
	}
	heard := server.Heard()
	if len(heard) == 0 || !vpntest.SMB(heard[0]) {
		t.Errorf("the server heard %q, want an SMB request", heard)
	}
}

func TestAnSMBTargetWhoseProxyRefusesConnectsNowhereElse(t *testing.T) {
	server, addr, remote := nas(t)
	p := startConnectProxy(t, false)
	if _, err := rclonefs.NewFs(throughRun(p.url), remote); err == nil {
		t.Fatal("the share opened while the proxy refused it")
	}
	if got := p.asked(); !slices.Contains(got, "CONNECT "+addr) {
		t.Errorf("the proxy was asked for %v, want %s", got, addr)
	}
	if heard := server.Heard(); len(heard) != 0 {
		t.Errorf("the server was reached past the proxy %d times", len(heard))
	}
}

func TestAnSMBTargetOutsideARunDialsOnItsOwn(t *testing.T) {
	server, _, remote := nas(t)
	ctx, ci := rclonefs.AddConfig(context.Background())
	ci.LowLevelRetries = 1
	rclonefs.NewFs(ctx, remote)
	if heard := server.Heard(); len(heard) == 0 || !vpntest.SMB(heard[0]) {
		t.Errorf("the server heard %q, want an SMB request", heard)
	}
}

func TestAnSMBTargetFailsOnceItsTunnelIsDown(t *testing.T) {
	server, _, remote := nas(t)
	p := startConnectProxy(t, true)
	gone := make(chan struct{})
	ctx := throughUntil(p.url, gone)
	rclonefs.NewFs(ctx, remote)
	close(gone)
	deadline := time.Now().Add(5 * time.Second)
	for relaysOpen(p.url) > 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := relaysOpen(p.url); n != 0 {
		t.Fatalf("%d relays stayed open after the tunnel went down", n)
	}
	before := len(server.Heard())
	if _, err := rclonefs.NewFs(ctx, remote); err == nil {
		t.Fatal("the share opened after the tunnel went down")
	}
	if heard := server.Heard(); len(heard) != before {
		t.Errorf("the server was reached after the tunnel went down")
	}
}

// relaysOpen counts the relays that reach their servers through proxy.
func relaysOpen(proxy string) int {
	relays.mu.Lock()
	defer relays.mu.Unlock()
	n := 0
	for key := range relays.open {
		if strings.HasPrefix(key, proxy+" ") {
			n++
		}
	}
	return n
}
