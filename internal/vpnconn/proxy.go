package vpnconn

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// proxy is how a run's connections reach the tunnel: rclone and its backends
// take an HTTP proxy and nothing else, so the tunnel sits behind one on
// loopback. It dials through the tunnel only, so a connection it cannot carry
// there fails rather than going out over the machine's own network.
type proxy struct {
	ln   net.Listener
	user string
	dial func(ctx context.Context, network, address string) (net.Conn, error)
	// forward carries plain HTTP, the one kind a proxy is asked for whole
	// rather than as a pipe.
	forward *http.Transport

	gone chan struct{}

	mu     sync.Mutex
	closed bool
	conns  map[net.Conn]struct{}
}

// connectWait bounds what comes before the bytes flow: the request and the
// connection to the server.
const connectWait = time.Minute

func startProxy(dial func(ctx context.Context, network, address string) (net.Conn, error)) (*proxy, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &proxy{
		ln:   ln,
		user: hex.EncodeToString(raw),
		dial: dial,
		forward: &http.Transport{
			Proxy:               nil,
			DialContext:         dial,
			ForceAttemptHTTP2:   true,
			MaxIdleConnsPerHost: 16,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 30 * time.Second,
		},
		gone:  make(chan struct{}),
		conns: map[net.Conn]struct{}{},
	}
	go p.serve()
	return p, nil
}

// URL is the proxy as rclone takes it. The user is a secret of this process,
// so nothing else on the machine can send through the tunnel.
func (p *proxy) URL() string {
	return (&url.URL{Scheme: "http", User: url.User(p.user), Host: p.ln.Addr().String()}).String()
}

// close stops the proxy and ends every connection that came through it.
func (p *proxy) close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	conns := p.conns
	p.conns = nil
	p.mu.Unlock()
	close(p.gone)
	p.ln.Close()
	for c := range conns {
		c.Close()
	}
	p.forward.CloseIdleConnections()
}

func (p *proxy) track(c net.Conn) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return false
	}
	p.conns[c] = struct{}{}
	return true
}

func (p *proxy) untrack(c net.Conn) {
	p.mu.Lock()
	delete(p.conns, c)
	p.mu.Unlock()
}

func (p *proxy) serve() {
	for {
		c, err := p.ln.Accept()
		if err != nil {
			return
		}
		go p.handle(c)
	}
}

func (p *proxy) handle(c net.Conn) {
	if !p.track(c) {
		c.Close()
		return
	}
	defer p.untrack(c)
	defer c.Close()
	in := bufio.NewReader(c)
	for {
		_ = c.SetReadDeadline(time.Now().Add(connectWait))
		req, err := http.ReadRequest(in)
		if err != nil {
			return
		}
		_ = c.SetReadDeadline(time.Time{})
		if !p.signedIn(req) {
			answer(c, http.StatusProxyAuthRequired, "Proxy Authentication Required")
			return
		}
		if req.Method == http.MethodConnect {
			p.pipe(c, in, req)
			return
		}
		if !p.pass(c, req) {
			return
		}
	}
}

func (p *proxy) signedIn(req *http.Request) bool {
	probe := http.Request{Header: http.Header{"Authorization": req.Header.Values("Proxy-Authorization")}}
	user, _, ok := probe.BasicAuth()
	return ok && subtle.ConstantTimeCompare([]byte(user), []byte(p.user)) == 1
}

// pipe answers a CONNECT, which is how every HTTPS request and every SFTP and
// FTP connection arrives: a raw stream to host:port through the tunnel.
func (p *proxy) pipe(c net.Conn, in *bufio.Reader, req *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), connectWait)
	server, err := p.dial(ctx, "tcp", req.Host)
	cancel()
	if err != nil {
		answer(c, http.StatusBadGateway, oneLine(err.Error()))
		return
	}
	if !p.track(server) {
		server.Close()
		return
	}
	defer p.untrack(server)
	defer server.Close()
	answer(c, http.StatusOK, "Connection Established")
	done := make(chan struct{}, 2)
	go func() {
		// What the client sent behind the request belongs to the server.
		_, _ = io.Copy(server, in)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(c, server)
		done <- struct{}{}
	}()
	<-done
}

// pass forwards one plain HTTP request and reports whether the connection
// can take another.
func (p *proxy) pass(c net.Conn, req *http.Request) bool {
	if !req.URL.IsAbs() {
		answer(c, http.StatusBadRequest, "Bad Request")
		return false
	}
	out := req.Clone(context.Background())
	out.RequestURI = ""
	for _, h := range hopByHop {
		out.Header.Del(h)
	}
	resp, err := p.forward.RoundTrip(out)
	if err != nil {
		answer(c, http.StatusBadGateway, oneLine(err.Error()))
		return false
	}
	defer resp.Body.Close()
	for _, h := range hopByHop {
		resp.Header.Del(h)
	}
	if err := resp.Write(c); err != nil {
		return false
	}
	return !req.Close && !resp.Close
}

// hopByHop are the headers that belong to one connection and are not passed
// on.
var hopByHop = []string{
	"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate",
	"Proxy-Authorization", "Te", "Trailer", "Upgrade",
}

func answer(w io.Writer, code int, reason string) {
	fmt.Fprintf(w, "HTTP/1.1 %d %s\r\nContent-Length: 0\r\n\r\n", code, reason)
}

// oneLine keeps an error fit for a status line, where rclone reads it.
func oneLine(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' {
			return ' '
		}
		return r
	}, s)
}
