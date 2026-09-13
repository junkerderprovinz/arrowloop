package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	// The zone database, COMPILED IN rather than read from the system.
	//
	// Android has no `/usr/share/zoneinfo`; its zone data lives in a format of
	// its own that the Go runtime does not read. Without this, every named zone
	// fails to load and the process runs in UTC - which on a phone in Berlin
	// means every cron expression fires two hours late, silently and with no
	// error anywhere. Measured: a job set to `0 0,8,16 * * *` reported its next
	// run as 00:00Z, which is 02:00 where the person set it.
	//
	// It costs about 450 KB in a binary that is already 79 MB, and it is the
	// only thing that makes `TZ` mean anything on a phone. Desktop and server
	// builds have a system database and are unaffected either way.
	_ "time/tzdata"
)

/*
What a Go program on Android has to be told, because it cannot find it out.

TWO SYSTEM SERVICES that exist on every Linux and on no Android: the resolver's
configuration and the zone database. Go reads `/etc/resolv.conf` for the first
and `/usr/share/zoneinfo` for the second, and Android has neither - it keeps
both behind framework APIs that only a Java process can call.

Neither failure announces itself. The zone one is silent: the process simply
runs in UTC. The DNS one produces a message that reads like a network fault and
is not one:

	lookup opencloud.bottich.lol on [::1]:53: read: connection refused

That is Go falling back to "the resolver is on localhost", which on a phone is
nothing at all. `curl` on the same phone reaches the same host, because it asks
Android instead of guessing.

So the app hands both in as environment variables when it starts the engine,
and this file turns them into settings the runtime honours. See
`mobile/native/java/design/halleluja/arrowloop/Engine.kt` for the other half.
*/

/** The nameservers to use, as the app found them. Comma-separated, IP only. */
const dnsVar = "ARROWLOOP_DNS"

/*
nameservers turns the app's list into addresses that can be dialled.

A FUNCTION OF ITS OWN because it is the part that can be wrong quietly: a list
parsed badly resolves nothing while producing exactly the failure it was written
to fix. Separated out, it is a string in and a list out, and a test can say what
it does.

Every entry gets the standard port unless it already names one, and an IPv6
address gets the brackets it needs to be dialled at all. Empty entries are
dropped rather than turned into ":53", which would dial the local machine - the
very thing that was broken.
*/
func nameservers(list string) []string {
	out := make([]string, 0, 3)
	for _, raw := range strings.Split(list, ",") {
		server := strings.TrimSpace(raw)
		if server == "" {
			continue
		}
		if _, _, err := net.SplitHostPort(server); err != nil {
			server = net.JoinHostPort(server, "53")
		}
		out = append(out, server)
	}
	return out
}

/*
useNameservers points the default resolver at servers somebody else discovered.

Only when the variable is set, so a desktop or a container - where
`/etc/resolv.conf` is real - is untouched.

EVERY LOOKUP IN THE PROCESS, because it replaces the dialler on
`net.DefaultResolver`: rclone's HTTP clients, the backends' own SDKs and the
engine's own requests all reach the same resolver without any of them knowing.
Setting it per-client would have meant finding every client rclone builds.

The servers are tried in order and the first that answers wins, which is the
same rule a resolv.conf with two lines follows.
*/
func useNameservers(list string) {
	servers := nameservers(list)
	if len(servers) == 0 {
		return
	}

	net.DefaultResolver = &net.Resolver{
		// Go's own resolver rather than the system one, which is the point:
		// the system one is what cannot be reached here.
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var last error
			for _, server := range servers {
				// A short timeout per server so two dead entries cannot hold a
				// lookup for the caller's whole patience. Five seconds is what
				// a resolv.conf defaults to.
				dialer := net.Dialer{Timeout: 5 * time.Second}
				conn, err := dialer.DialContext(ctx, network, server)
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, fmt.Errorf("no nameserver answered (%d tried): %w", len(servers), last)
		},
	}
}

/*
Where Android keeps the certificate authorities, in the order to try them.

THE THIRD SERVICE Go cannot find here, and it turned up the moment the second
was fixed: with DNS working, the very next request failed with

	tls: failed to verify certificate: x509: certificate signed by unknown authority

Go looks for a bundle at the Linux paths (`/etc/ssl/certs/ca-certificates.crt`
and friends). Android has no bundle at all - it keeps one PEM file per authority
in a directory, named by hash, which is a shape Go DOES read but only when it is
told where. Measured on jdp's phone: 149 files in the first path, 145 in the
Conscrypt one, which newer Android versions prefer.

Both are listed because which one is populated varies by version, and Go accepts
a colon-separated list and simply skips what is not there.
*/
var androidCertDirs = []string{
	"/system/etc/security/cacerts",
	"/apex/com.android.conscrypt/cacerts",
	"/etc/security/cacerts",
}

/*
useSystemCertificates points the verifier at the store this platform actually
has.

Only when SSL_CERT_DIR is unset, so anybody who set it on purpose keeps their
choice, and only for directories that EXIST - handing Go a list of absent paths
would replace "no certificates found" with "no certificates found", and hide
that the fallback did nothing.

Returns what it set, for the caller to log or a test to read.
*/
func useSystemCertificates() string {
	if os.Getenv("SSL_CERT_DIR") != "" {
		return ""
	}
	found := make([]string, 0, len(androidCertDirs))
	for _, dir := range androidCertDirs {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			continue
		}
		// An empty directory is not a certificate store, and counting it would
		// make the difference between "set up" and "set up and useless"
		// invisible.
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) == 0 {
			continue
		}
		found = append(found, dir)
	}
	if len(found) == 0 {
		return ""
	}
	list := strings.Join(found, ":")
	_ = os.Setenv("SSL_CERT_DIR", list)
	return list
}

// applyAndroidEnvironment wires in whatever this platform needs and cannot say.
//
// Called once, before anything opens a connection - the certificate store in
// particular is read on the FIRST handshake and cached, so setting it later
// would appear to work and change nothing.
//
// Every part is a no-op where it does not apply: the desktop and the container
// have a resolver configuration and a certificate bundle, and neither branch
// below fires there.
func applyAndroidEnvironment() {
	if list := os.Getenv(dnsVar); list != "" {
		useNameservers(list)
	}
	useSystemCertificates()
}
