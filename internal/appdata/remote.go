package appdata

import (
	"fmt"
	"net"
	"os"

	"github.com/rclone/rclone/fs/config"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// RemoteName is the target the app folders show up as.
const RemoteName = "Android"

// marker tells the remote set up here from one a person named the same.
const marker = "Android/data on this phone, set up by ArrowLoop"

// Link points the remote at a server on addr and pins its host key in
// knownHosts.
func Link(addr, password string, seed []byte, knownHosts string) error {
	data := config.LoadedData()
	if data.HasSection(RemoteName) {
		if v, _ := data.GetValue(RemoteName, "description"); v != marker {
			return fmt.Errorf("a target called %s already exists, so Android/data is not offered", RemoteName)
		}
	}
	pub, err := PublicKey(seed)
	if err != nil {
		return err
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	line := knownhosts.Line([]string{knownhosts.Normalize(addr)}, pub)
	if err := os.WriteFile(knownHosts, []byte(line+"\n"), 0o600); err != nil {
		return err
	}
	return remotes.Save(RemoteName, "sftp", map[string]string{
		"host":             host,
		"port":             port,
		"user":             User,
		"pass":             password,
		"known_hosts_file": knownHosts,
		"set_modtime":      "true",
		// The server has no shell, so there is nothing to compute hashes with.
		"shell_type":      "none",
		"md5sum_command":  "none",
		"sha1sum_command": "none",
		"description":     marker,
	})
}

// Unlink removes the remote if it is the one Link set up.
func Unlink() error {
	data := config.LoadedData()
	if v, _ := data.GetValue(RemoteName, "description"); v != marker {
		return nil
	}
	return remotes.Delete(RemoteName)
}
