package hold

import (
	"net"
	"net/netip"
)

// probes are set aside for documentation, so only a default route leads to
// them.
var probes = []string{"192.0.2.1:9", "[2001:db8::1]:9"}

// Routed reports whether the kernel knows a way to the internet, over IPv4 or
// IPv6. A phone in flight mode has none.
func Routed() bool { return len(Leaves()) > 0 }

// Leaves returns the addresses this machine's traffic to the internet leaves
// from, one for IPv4 and one for IPv6 where there is a route. Connecting a UDP
// socket sends nothing, it only looks the route up.
func Leaves() []netip.Addr {
	var out []netip.Addr
	for _, addr := range probes {
		c, err := net.Dial("udp", addr)
		if err != nil {
			continue
		}
		if local, ok := c.LocalAddr().(*net.UDPAddr); ok {
			out = append(out, bare(local.AddrPort().Addr()))
		}
		c.Close()
	}
	return out
}
