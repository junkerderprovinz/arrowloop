package web

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Guard wraps the handler of a server that listens on a network port. A page
// on any web site can make the browser send a request to that port, so Guard
// refuses a change another site's page started, and on an install with no
// password it answers only to names nobody outside can point at this machine.
// The desktop window needs neither, since nothing but its own page reaches it.
func (s *Server) Guard(next http.Handler) http.Handler {
	crossOrigin := http.NewCrossOriginProtection()
	crossOrigin.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusForbidden, errors.New("a page from another site cannot change anything here"))
	}))
	return crossOrigin.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A page on attacker.example whose name is re-pointed at this machine
		// is same-origin to the browser. With a password that page has no
		// cookie; without one the host name is all there is to check.
		if len(s.passwordHash()) == 0 && !localName(r.Host) {
			writeError(w, http.StatusMisdirectedRequest, errors.New(
				"ArrowLoop has no password yet, so it answers only on an IP address, localhost or a local name such as tower or nas.local. Open it there, or set a password there first"))
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// localSuffixes are domains no public DNS server answers for, so nobody
// outside the network can point one at this machine.
var localSuffixes = []string{".localhost", ".local", ".lan", ".home.arpa", ".internal"}

// localName reports whether a Host header names this machine in a way an
// outsider cannot: an IP address, localhost, a name without a dot, or a name
// under one of localSuffixes.
func localName(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSuffix(strings.Trim(host, "[]"), "."))
	if host == "" || host == "localhost" || !strings.Contains(host, ".") {
		return true
	}
	if _, err := netip.ParseAddr(host); err == nil {
		return true
	}
	for _, suffix := range localSuffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}
