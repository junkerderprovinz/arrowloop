package hold

import "net"

// Routed reports whether the kernel knows a way to the internet, over IPv4 or
// IPv6. Connecting a UDP socket sends nothing, it only looks the route up, and
// a phone in flight mode has none. The addresses are set aside for
// documentation, so only a default route leads to them.
func Routed() bool {
	for _, addr := range []string{"192.0.2.1:9", "[2001:db8::1]:9"} {
		if c, err := net.Dial("udp", addr); err == nil {
			c.Close()
			return true
		}
	}
	return false
}
