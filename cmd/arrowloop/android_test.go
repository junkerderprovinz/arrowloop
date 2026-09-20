package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

// An empty list is the desktop or container case, and also a phone whose
// framework gave no answer, where guessing a public resolver would be worse.
func TestAnEmptyListLeavesTheResolverAlone(t *testing.T) {
	for _, list := range []string{"", "   ", ",", " , , "} {
		previous := net.DefaultResolver
		useNameservers(list)
		if net.DefaultResolver != previous {
			net.DefaultResolver = previous
			t.Errorf("%q replaced the resolver", list)
		}
	}
}

// Without PreferGo the runtime may still use the system resolver.
func TestAListReplacesTheResolverAndPrefersGosOwn(t *testing.T) {
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })

	useNameservers("192.168.1.1")
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
