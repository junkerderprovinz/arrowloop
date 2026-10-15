package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTheNameserverListIsReadTheWayAndroidWritesIt(t *testing.T) {
	for _, c := range []struct {
		name string
		list string
		want []string
	}{
		{
			name: "one plain address gets the standard port",
			list: "192.168.1.1",
			want: []string{"192.168.1.1:53"},
		},
		{
			name: "two of them, in the order given, because the first that answers wins",
			list: "192.168.1.1,1.1.1.1",
			want: []string{"192.168.1.1:53", "1.1.1.1:53"},
		},
		{
			name: "spaces around the commas are somebody's formatting",
			list: " 192.168.1.1 , 1.1.1.1 ",
			want: []string{"192.168.1.1:53", "1.1.1.1:53"},
		},
		{
			name: "an address that already names a port keeps it",
			list: "192.168.1.1:5353",
			want: []string{"192.168.1.1:5353"},
		},
		{
			// A phone on a v6-only mobile network hands over exactly this.
			name: "IPv6 gets its brackets",
			list: "2606:4700:4700::1111",
			want: []string{"[2606:4700:4700::1111]:53"},
		},
		{
			// ":53" alone would dial the local machine.
			name: "empty entries are dropped rather than turned into localhost",
			list: "192.168.1.1,,1.1.1.1,",
			want: []string{"192.168.1.1:53", "1.1.1.1:53"},
		},
		{name: "nothing at all", list: "", want: nil},
		{name: "only separators and space", list: " , , ", want: nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := nameservers(c.list)
			if strings.Join(got, " ") != strings.Join(c.want, " ") {
				t.Errorf("nameservers(%q) = %v, want %v", c.list, got, c.want)
			}
			for _, server := range got {
				if _, _, err := net.SplitHostPort(server); err != nil {
					t.Errorf("%q cannot be dialled: %v", server, err)
				}
			}
		})
	}
}

// Without the variable this is the desktop or container, where the system
// resolver works.
func TestNoFileLeavesTheResolverAlone(t *testing.T) {
	t.Setenv(dnsVar, "")
	previous := net.DefaultResolver
	applyAndroidEnvironment()
	if net.DefaultResolver != previous {
		net.DefaultResolver = previous
		t.Error("the resolver was replaced without a nameserver file")
	}
}

// Without PreferGo the runtime may still use the system resolver.
func TestAFileReplacesTheResolverAndPrefersGosOwn(t *testing.T) {
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })

	useNameservers(filepath.Join(t.TempDir(), "nameservers"))
	if net.DefaultResolver == previous {
		t.Fatal("the resolver was not replaced")
	}
	if !net.DefaultResolver.PreferGo {
		t.Error("the replacement does not prefer Go's own resolver")
	}
	if net.DefaultResolver.Dial == nil {
		t.Error("the replacement has no dialler, so it would use the system one")
	}
}

// nameserver stands in for a DNS server reached over TCP and reports each
// connection the resolver opens to it.
func nameserver(t *testing.T) (string, <-chan struct{}) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { listener.Close() })
	reached := make(chan struct{}, 8)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
			reached <- struct{}{}
		}
	}()
	return listener.Addr().String(), reached
}

func dialResolver(t *testing.T) {
	t.Helper()
	conn, err := net.DefaultResolver.Dial(context.Background(), "tcp", "127.0.0.1:53")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.Close()
}

func expectReached(t *testing.T, name string, reached <-chan struct{}) {
	t.Helper()
	select {
	case <-reached:
	case <-time.After(2 * time.Second):
		t.Fatalf("the lookup did not go to %s", name)
	}
}

func TestLookupsFollowTheNetworkThePhoneIsOnNow(t *testing.T) {
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })
	router, atHome := nameserver(t)
	carrier, onTheRoad := nameserver(t)
	file := filepath.Join(t.TempDir(), "nameservers")

	if err := os.WriteFile(file, []byte(router), 0o600); err != nil {
		t.Fatal(err)
	}
	useNameservers(file)
	dialResolver(t)
	expectReached(t, "the router on Wi-Fi", atHome)

	if err := os.WriteFile(file, []byte(carrier), 0o600); err != nil {
		t.Fatal(err)
	}
	dialResolver(t)
	expectReached(t, "the carrier's server on mobile data", onTheRoad)
}

func TestARetryAsksTheNextServer(t *testing.T) {
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })
	first, toFirst := nameserver(t)
	second, toSecond := nameserver(t)
	file := filepath.Join(t.TempDir(), "nameservers")
	if err := os.WriteFile(file, []byte(first+","+second), 0o600); err != nil {
		t.Fatal(err)
	}

	useNameservers(file)
	dialResolver(t)
	expectReached(t, "the first server", toFirst)
	dialResolver(t)
	expectReached(t, "the second server", toSecond)
}

// Dialling Go's fallback on localhost instead would only fail later and
// less clearly.
func TestAnEmptyOrMissingFileFailsTheLookup(t *testing.T) {
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })
	dir := t.TempDir()
	empty := filepath.Join(dir, "empty")
	if err := os.WriteFile(empty, []byte(" , "), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, file := range []string{empty, filepath.Join(dir, "missing")} {
		useNameservers(file)
		conn, err := net.DefaultResolver.Dial(context.Background(), "udp", "127.0.0.1:53")
		if err == nil {
			conn.Close()
			t.Errorf("%s: a lookup went out with no nameserver known", filepath.Base(file))
		}
	}
}

func TestTheCertificateStoreIsOnlyClaimedWhenOneIsThere(t *testing.T) {
	t.Setenv("SSL_CERT_DIR", "")
	// None of Android's paths exist where the tests run.
	if got := useSystemCertificates(); got != "" {
		t.Errorf("claimed %q on a machine with no Android store", got)
	}
	if os.Getenv("SSL_CERT_DIR") != "" {
		t.Errorf("SSL_CERT_DIR was set to %q anyway", os.Getenv("SSL_CERT_DIR"))
	}

	// A directory with something in it is taken, as on a phone.
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "01419da9.0"), []byte("-----BEGIN CERTIFICATE-----\n"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	previous := androidCertDirs
	t.Cleanup(func() { androidCertDirs = previous })
	androidCertDirs = []string{filepath.Join(dir, "nope"), dir}
	if got := useSystemCertificates(); got != dir {
		t.Errorf("claimed %q, want just the directory that exists (%q)", got, dir)
	}

	// A value somebody set is never overridden.
	t.Setenv("SSL_CERT_DIR", "/somewhere/chosen")
	if got := useSystemCertificates(); got != "" {
		t.Errorf("overrode a chosen setting with %q", got)
	}
	if os.Getenv("SSL_CERT_DIR") != "/somewhere/chosen" {
		t.Errorf("the chosen setting became %q", os.Getenv("SSL_CERT_DIR"))
	}
}

func TestAnEmptyDirectoryIsNotAStore(t *testing.T) {
	t.Setenv("SSL_CERT_DIR", "")
	previous := androidCertDirs
	t.Cleanup(func() { androidCertDirs = previous })
	androidCertDirs = []string{t.TempDir()}
	if got := useSystemCertificates(); got != "" {
		t.Errorf("claimed an empty directory: %q", got)
	}
}
