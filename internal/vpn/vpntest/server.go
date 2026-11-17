package vpntest

import (
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"testing"

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

	dev *device.Device
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
