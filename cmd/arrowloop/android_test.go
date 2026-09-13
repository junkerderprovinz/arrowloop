package main

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
The nameserver list, read the way Android hands it over.

jdp: "ich habe den app token in OpenCloud eingegeben aber die verbindung geht
nicht." Neither the token nor the address was wrong. Go on Android has no
`/etc/resolv.conf`, falls back to asking a resolver on localhost, and every
hostname dies with:

	lookup opencloud.bottich.lol on [::1]:53: read: connection refused

This is the parser for the list the app hands in instead, and it is the piece
that can be wrong QUIETLY: a list read badly resolves nothing at all, which
looks exactly like the bug it was written to fix.
*/
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
			// Without the brackets this is not dialable at all, and a phone on
			// a v6-only mobile network hands over exactly this.
			name: "IPv6 gets its brackets",
			list: "2606:4700:4700::1111",
			want: []string{"[2606:4700:4700::1111]:53"},
		},
		{
			// ":53" alone would dial THIS MACHINE, which is the failure the
			// whole file exists to remove.
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
			// Every entry has to survive a round trip through the thing that
			// will actually dial it. A string that splits wrongly here would
			// fail at the first lookup and nowhere earlier.
			for _, server := range got {
				if _, _, err := net.SplitHostPort(server); err != nil {
					t.Errorf("%q cannot be dialled: %v", server, err)
				}
			}
		})
	}
}

/*
An empty list leaves the resolver exactly as it was.

That is the desktop and the container, where `/etc/resolv.conf` is real and
replacing the resolver would be a downgrade - and it is also the phone whose
framework declined to answer, where the honest fallback is Go's own behaviour
rather than a guessed public resolver. Guessing one would send every lookup this
phone makes to a company nobody chose.
*/
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

/*
A list with something in it DOES replace the resolver, and prefers Go's own.

`PreferGo` is the half that is easy to leave out and impossible to notice:
without it the runtime may still reach for the system resolver, which on this
platform is the thing that does not exist.
*/
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

/*
The certificate store is only claimed when one is really there.

The third missing service, and the one that hides best: with DNS fixed, the very
next request failed with "certificate signed by unknown authority", which reads
like a bad certificate on the server and is a missing trust store on the client.

Two ways to get this wrong quietly, and both are pinned here. Setting the
variable to directories that do not exist replaces "no certificates" with "no
certificates" while looking configured; and overriding a value somebody set on
purpose takes away a choice that was made deliberately.
*/
func TestTheCertificateStoreIsOnlyClaimedWhenOneIsThere(t *testing.T) {
	t.Setenv("SSL_CERT_DIR", "")
	// This test runs on a desktop, where none of Android's paths exist, so the
	// honest outcome is to leave the variable alone.
	if got := useSystemCertificates(); got != "" {
		t.Errorf("claimed %q on a machine with no Android store", got)
	}
	if os.Getenv("SSL_CERT_DIR") != "" {
		t.Errorf("SSL_CERT_DIR was set to %q anyway", os.Getenv("SSL_CERT_DIR"))
	}

	// A REAL directory with something in it is taken, which is the phone's case.
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

	// And a value somebody set on purpose is never overridden.
	t.Setenv("SSL_CERT_DIR", "/somewhere/chosen")
	if got := useSystemCertificates(); got != "" {
		t.Errorf("overrode a deliberate setting with %q", got)
	}
	if os.Getenv("SSL_CERT_DIR") != "/somewhere/chosen" {
		t.Errorf("the deliberate setting became %q", os.Getenv("SSL_CERT_DIR"))
	}
}

/*
An EMPTY directory is not a certificate store.

It is the difference between "set up" and "set up and useless", and only one of
those is worth reporting as configured.
*/
func TestAnEmptyDirectoryIsNotAStore(t *testing.T) {
	t.Setenv("SSL_CERT_DIR", "")
	previous := androidCertDirs
	t.Cleanup(func() { androidCertDirs = previous })
	androidCertDirs = []string{t.TempDir()}
	if got := useSystemCertificates(); got != "" {
		t.Errorf("claimed an empty directory: %q", got)
	}
}
