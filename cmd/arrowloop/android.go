package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync/atomic"
	"time"

	// Android has no /usr/share/zoneinfo in a form Go reads, so without the
	// embedded database every named zone falls back to UTC and cron schedules
	// fire hours off. It adds about 450 KB.
	_ "time/tzdata"
)

// Android has neither /etc/resolv.conf nor a certificate bundle at the Linux
// paths; both sit behind framework APIs only Java can call. Without a resolver
// Go asks one on localhost and every lookup fails with "connection refused".
// The app passes what it found in environment variables (see
// mobile/native/java/arrowloop/halleluja/design/Engine.kt), and this file
// turns them into settings the runtime honours.

// dnsVar names the file holding the active network's nameservers,
// comma-separated, IP only. The app rewrites it whenever the phone changes
// networks, so the list cannot be fixed at start: an engine started on Wi-Fi
// would keep asking the router at home once the phone is on mobile data.
const dnsVar = "ARROWLOOP_DNS_FILE"

// nameservers turns the app's list into addresses that can be dialled. Entries
// without a port get 53, IPv6 addresses get brackets, and empty entries are
// dropped rather than becoming ":53", which would dial the local machine.
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

// useNameservers points net.DefaultResolver at the servers listed in file,
// which covers every lookup in the process, rclone's clients included. The
// file is read on every dial, since the list changes with the network.
func useNameservers(file string) {
	var next atomic.Uint32
	net.DefaultResolver = &net.Resolver{
		// The system resolver is what cannot be reached here.
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			list, err := os.ReadFile(file)
			if err != nil {
				return nil, fmt.Errorf("no nameservers known: %w", err)
			}
			servers := nameservers(string(list))
			if len(servers) == 0 {
				return nil, errors.New("no nameservers known")
			}
			// A UDP dial succeeds without sending anything, so a server that
			// never answers is only found out by the query timing out. Each
			// of Go's retries starts one server further on, so they do not
			// all wait for the same dead one.
			first := int(next.Add(1) - 1)
			var last error
			for i := range servers {
				// Five seconds per server, the resolv.conf default.
				dialer := net.Dialer{Timeout: 5 * time.Second}
				conn, err := dialer.DialContext(ctx, network, servers[(first+i)%len(servers)])
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, fmt.Errorf("no nameserver answered (%d tried): %w", len(servers), last)
		},
	}
}

// androidCertDirs are where Android keeps one PEM file per certificate
// authority, which Go reads when SSL_CERT_DIR names the directory. Which one is
// populated varies by Android version; newer versions use the Conscrypt one.
var androidCertDirs = []string{
	"/system/etc/security/cacerts",
	"/apex/com.android.conscrypt/cacerts",
	"/etc/security/cacerts",
}

// useSystemCertificates sets SSL_CERT_DIR to the Android certificate
// directories that exist and are not empty, and returns what it set. It leaves
// a value somebody already set alone.
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

// applyAndroidEnvironment applies the Android settings above. It has to run
// before the first TLS handshake, which reads and caches the certificate
// store. Elsewhere neither setting applies and nothing changes.
func applyAndroidEnvironment() {
	if file := os.Getenv(dnsVar); file != "" {
		useNameservers(file)
	}
	useSystemCertificates()
}
