package remotes

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/obscure"

	"github.com/junkerderprovinz/arrowloop/internal/certpin"
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
	ctx := vpnconn.Through(context.Background(), proxy)
	ctx, ci := rclonefs.AddConfig(ctx)
	ci.HTTPProxy = proxy
	ci.ConnectTimeout = rclonefs.Duration(3 * time.Second)
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
