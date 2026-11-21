package vpntest

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"

	"github.com/junkerderprovinz/arrowloop/internal/vpn"
)

// Addresses inside the tunnel: the server's and the client's.
var (
	ServerAddr = netip.MustParseAddr("10.2.0.1")
	ClientAddr = netip.MustParseAddr("10.2.0.2")
)

// Server is a running WireGuard server and the client key it lets in. Its
// tunnel address answers HTTP on port 80, and nothing outside the tunnel
// reaches that.
type Server struct {
	Key       vpn.Key
	ClientKey vpn.Key
	Port      uint16

	dev  *device.Device
	tnet *netstack.Net
}

// Start runs a server on a free UDP port of loopback that serves h inside the
// tunnel, and closes it when t ends.
func Start(t testing.TB, h http.Handler) *Server {
	t.Helper()
	sk, err := vpn.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	ck, err := vpn.GeneratePrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{Key: sk, ClientKey: ck}
	tdev, tnet, err := netstack.CreateNetTUN([]netip.Addr{ServerAddr}, nil, vpn.DefaultMTU)
	if err != nil {
		t.Fatal(err)
	}
	s.tnet = tnet
	s.dev = device.NewDevice(tdev, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))
	pub := ck.PublicKey()
	uapi := fmt.Sprintf("private_key=%x\nlisten_port=0\npublic_key=%x\nallowed_ip=%s/32\n", sk[:], pub[:], ClientAddr)
	if err := s.dev.IpcSet(uapi); err != nil {
		t.Fatal(err)
	}
	if err := s.dev.Up(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	got, _ := s.dev.IpcGet()
	for _, line := range strings.Split(got, "\n") {
		if v, ok := strings.CutPrefix(line, "listen_port="); ok {
			fmt.Sscan(v, &s.Port)
		}
	}
	web, err := tnet.ListenTCPAddrPort(netip.AddrPortFrom(ServerAddr, 80))
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: h}
	go srv.Serve(web)
	t.Cleanup(func() { srv.Close() })
	return s
}

// Config is the client's configuration, as a provider hands it out.
func (s *Server) Config() string {
	return fmt.Sprintf("[Interface]\nPrivateKey = %s\nAddress = %s/32\n\n[Peer]\nPublicKey = %s\nAllowedIPs = 0.0.0.0/0\nEndpoint = 127.0.0.1:%d\n",
		s.ClientKey, ClientAddr, s.Key.PublicKey(), s.Port)
}

// Close stops the server, as a provider's server that goes away.
func (s *Server) Close() { s.dev.Close() }

// Listen takes TCP connections on port of the server's tunnel address, for a
// server other than the HTTP one.
func (s *Server) Listen(t testing.TB, port uint16) net.Listener {
	t.Helper()
	ln, err := s.tnet.ListenTCPAddrPort(netip.AddrPortFrom(ServerAddr, port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln
}

// Hangup stands in for a server whose protocol a test does not speak: it
// keeps the first bytes of every connection and hangs up.
type Hangup struct {
	mu    sync.Mutex
	heard [][]byte
}

// HangUp answers every connection on ln until ln is closed.
func HangUp(ln net.Listener) *Hangup {
	h := &Hangup{}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go h.take(c)
		}
	}()
	return h
}

func (h *Hangup) take(c net.Conn) {
	defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	got := make([]byte, 8)
	n, _ := io.ReadFull(c, got)
	h.mu.Lock()
	h.heard = append(h.heard, got[:n])
	h.mu.Unlock()
}

// Heard is what each connection began with, in the order they came.
func (h *Hangup) Heard() [][]byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([][]byte(nil), h.heard...)
}

// SMB reports whether a connection began with an SMB request, which comes
// behind the four bytes that frame it on TCP.
func SMB(first []byte) bool {
	return len(first) == 8 && (first[4] == 0xfe || first[4] == 0xff) && string(first[5:8]) == "SMB"
}
