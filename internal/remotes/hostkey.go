package remotes

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/rclone/rclone/fs/config"
	"golang.org/x/crypto/ssh"
)

// hostKeysKey is rclone's sftp setting that pins the server's host key.
// Without a pin or a known_hosts_file rclone connects to whichever server
// answers.
const hostKeysKey = "host_keys"

// HostKey is the key an SSH server proves itself with.
type HostKey struct {
	// Pin is the key as host_keys takes it.
	Pin string
	// Fingerprint is the SHA256 fingerprint providers publish and ssh prints.
	Fingerprint string
}

var errGotHostKey = errors.New("host key read")

// readHostKey asks an SSH server for its host key and hangs up before signing
// in. rclone negotiates only the algorithms of the keys pinned, so the one
// key read here is all a target needs. Certificates are not asked for, since
// rclone cannot pin one.
func readHostKey(ctx context.Context, host, port string) (HostKey, error) {
	if port == "" {
		port = "22"
	}
	ctx, cancel := context.WithTimeout(ctx, CheckWait)
	defer cancel()
	addr := net.JoinHostPort(host, port)
	conn, err := new(net.Dialer).DialContext(ctx, "tcp", addr)
	if err != nil {
		return HostKey{}, fmt.Errorf("read the host key of %s: %w", addr, err)
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	var got ssh.PublicKey
	_, _, _, err = ssh.NewClientConn(conn, addr, &ssh.ClientConfig{
		User: "arrowloop",
		HostKeyAlgorithms: []string{
			ssh.KeyAlgoED25519, ssh.KeyAlgoECDSA256, ssh.KeyAlgoECDSA384, ssh.KeyAlgoECDSA521,
			ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256,
		},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			got = key
			return errGotHostKey
		},
	})
	if got == nil {
		return HostKey{}, fmt.Errorf("read the host key of %s: %w", addr, err)
	}
	return HostKey{
		Pin:         got.Type() + " " + base64.StdEncoding.EncodeToString(got.Marshal()),
		Fingerprint: ssh.FingerprintSHA256(got),
	}, nil
}

// pinnedKey is the first key of a host_keys setting, for its fingerprint.
func pinnedKey(pins string) (HostKey, bool) {
	first, _, _ := strings.Cut(pins, ",")
	_, encoded, ok := strings.Cut(strings.TrimSpace(first), " ")
	if !ok {
		return HostKey{}, false
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return HostKey{}, false
	}
	key, err := ssh.ParsePublicKey(raw)
	if err != nil {
		return HostKey{}, false
	}
	return HostKey{Pin: strings.TrimSpace(first), Fingerprint: ssh.FingerprintSHA256(key)}, true
}

// checksHostKey reports whether sftp settings already say how to check the
// server: a pin, a known_hosts file (or none, said on purpose), or an ssh
// command that checks for itself.
func checksHostKey(get func(string) string) bool {
	return get(hostKeysKey) != "" || get("known_hosts_file") != "" || get("ssh") != ""
}

// pinSaved pins a saved sftp target that does not say how to check its
// server to the key the server shows now. A target set up before pinning,
// or saved without a test, is pinned at its first check.
func pinSaved(ctx context.Context, name string) error {
	data := config.LoadedData()
	get := func(key string) string {
		v, _ := data.GetValue(name, key)
		return strings.TrimSpace(v)
	}
	if get("type") != "sftp" || get("host") == "" || checksHostKey(get) {
		return nil
	}
	key, err := readHostKey(ctx, get("host"), get("port"))
	if err != nil {
		return err
	}
	data.SetValue(name, hostKeysKey, key.Pin)
	if err := data.Save(); err != nil {
		return fmt.Errorf("write rclone's configuration: %w", err)
	}
	return nil
}
