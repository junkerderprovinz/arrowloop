package main

import (
	"net"
	"strings"
	"testing"
)

func TestTheDirectAddressIsWhereTheNetworkReachesTheListener(t *testing.T) {
	for _, tc := range []struct {
		name   string
		listen *net.TCPAddr
		want   string
	}{
		{"loopback only", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 8422}, ""},
		{"one address", &net.TCPAddr{IP: net.IPv4(192, 168, 10, 10), Port: 8422}, "http://192.168.10.10:8422"},
		{"one IPv6 address", &net.TCPAddr{IP: net.ParseIP("fd00::10"), Port: 8422}, "http://[fd00::10]:8422"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := directURL(tc.listen); got != tc.want {
				t.Errorf("directURL(%v) = %q, want %q", tc.listen, got, tc.want)
			}
		})
	}
	every := directURL(&net.TCPAddr{IP: net.IPv4zero, Port: 8422})
	if every != "" && (!strings.HasPrefix(every, "http://") || !strings.HasSuffix(every, ":8422") || strings.Contains(every, "0.0.0.0")) {
		t.Errorf("listening on every address gives %q, want this machine's own address on the port", every)
	}
}
