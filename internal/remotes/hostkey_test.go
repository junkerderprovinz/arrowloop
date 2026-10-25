package remotes_test

import (
	"context"
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	_ "github.com/rclone/rclone/backend/sftp"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
	"golang.org/x/crypto/ssh"

	"github.com/junkerderprovinz/arrowloop/internal/appdata"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// sftpServer answers on a port of its own with a host key of its own, and
// returns the form of a target that reaches it and that key's fingerprint.
func sftpServer(t *testing.T) (map[string]string, string) {
	t.Helper()
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() { _ = appdata.ServeSFTP(ln, "letmein", seed, sftp.InMemHandler()) }()

	pub, err := appdata.PublicKey(seed)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{
		"host": "127.0.0.1",
		"port": strconv.Itoa(ln.Addr().(*net.TCPAddr).Port),
		"user": appdata.User,
		"pass": "letmein",
		// The in-memory server has no shell to work out hashes with.
		"shell_type": "none", "md5sum_command": "none", "sha1sum_command": "none",
	}, ssh.FingerprintSHA256(pub)
}

func freshConfig(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.SetConfigPath(path); err != nil {
		t.Fatal(err)
	}
	configfile.Install()
}

func savedPin(name string) string {
	pin, _ := config.LoadedData().GetValue(name, "host_keys")
	return pin
}

func TestATestShowsTheServersKeyAndTheSavePinsIt(t *testing.T) {
	freshConfig(t)
	form, fingerprint := sftpServer(t)

	key, err := remotes.Try(context.Background(), "", "sftp", form)
	if err != nil {
		t.Fatalf("try: %v", err)
	}
	if key == nil || key.Fingerprint != fingerprint {
		t.Fatalf("the test showed %+v, want the server's %s", key, fingerprint)
	}
	if err := remotes.Save("box", "sftp", form); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(savedPin("box"), "ssh-ed25519 ") {
		t.Fatalf("the saved target is pinned to %q, want the server's key", savedPin("box"))
	}
}

// A target saved before pinning, or without a test, is pinned the first time
// it is checked.
func TestASavedTargetIsPinnedAtItsFirstCheck(t *testing.T) {
	freshConfig(t)
	form, _ := sftpServer(t)
	if err := remotes.Save("box", "sftp", form); err != nil {
		t.Fatal(err)
	}
	if err := remotes.Check(context.Background(), "box"); err != nil {
		t.Fatalf("check: %v", err)
	}
	if savedPin("box") == "" {
		t.Fatal("the target was checked without being pinned")
	}
}

func TestAServerWithAnotherKeyIsRefused(t *testing.T) {
	freshConfig(t)
	form, _ := sftpServer(t)
	if err := remotes.Save("box", "sftp", form); err != nil {
		t.Fatal(err)
	}
	if err := remotes.Check(context.Background(), "box"); err != nil {
		t.Fatalf("check: %v", err)
	}

	// Another server where the pinned one was.
	other, _ := sftpServer(t)
	config.LoadedData().SetValue("box", "port", other["port"])

	err := remotes.Check(context.Background(), "box")
	if err == nil || !strings.Contains(err.Error(), "empty host_keys") {
		t.Fatalf("a server with another key answered %v, want a refusal that says what to do", err)
	}
}
