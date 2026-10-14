package appdata

import (
	"fmt"
	"net"
	"os"

	"github.com/rclone/rclone/fs/config"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// Target is a remote ArrowLoop sets up by itself to reach one of these
// servers. Its description tells it from a remote a person named the same.
type Target struct {
	Name   string
	Marker string
}

// AndroidData is the target the app folders show up as.
var AndroidData = Target{Name: "Android", Marker: "Android/data on this phone, set up by ArrowLoop"}

// Link points the remote at a server on addr and pins its host key in
// knownHosts.
func (t Target) Link(addr, password string, seed []byte, knownHosts string) error {
	data := config.LoadedData()
	if data.HasSection(t.Name) {
		if v, _ := data.GetValue(t.Name, "description"); v != t.Marker {
			return fmt.Errorf("a target called %s already exists, so it is not set up", t.Name)
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
	return remotes.Save(t.Name, "sftp", map[string]string{
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
		"description":     t.Marker,
	})
}

// Unlink removes the remote if it is the one Link set up.
func (t Target) Unlink() error {
	data := config.LoadedData()
	if v, _ := data.GetValue(t.Name, "description"); v != t.Marker {
		return nil
	}
	return remotes.Delete(t.Name)
}
