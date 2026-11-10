package main

import (
	"net"
	"net/netip"
	"strconv"

	"github.com/junkerderprovinz/parleyport/kit/lan"
)

// lanGroup is where the ArrowLoop instances on one network announce
// themselves, apart from the addresses the other apps of the family use.
var lanGroup = netip.MustParseAddrPort("239.255.77.50:8752")

// defaultPort is what a sweep of the network tries on every neighbour besides
// the port this instance listens on.
const defaultPort = 8422

// directURL is where the other instances on the network reach a server
// listening at addr, "" when it listens on the loopback only.
func directURL(addr net.Addr) string {
	tcp, ok := addr.(*net.TCPAddr)
	if !ok || tcp.IP.IsLoopback() {
		return ""
	}
	host := tcp.IP.String()
	if tcp.IP.IsUnspecified() {
		if host = lan.LocalIPv4(); host == "" {
			return ""
		}
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(tcp.Port))
}
