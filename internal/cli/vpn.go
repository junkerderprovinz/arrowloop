package cli

import (
	"path/filepath"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/security"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// withVPN gives runner the VPNs kept beside the configuration, so a job that
// goes through one runs from the command line as it does in the app. Nothing
// connects until a run asks. The returned func closes the tunnels.
func withVPN(runner *daemon.Runner, configPath string, logf func(string, ...any)) (func(), error) {
	key, err := security.LoadKey(configPath)
	if err != nil {
		return nil, err
	}
	tunnel, err := vpnconn.New(vpnconn.Options{Dir: filepath.Dir(configPath), Key: key, Logf: logf})
	if err != nil {
		return nil, err
	}
	runner.SetVPN(tunnel)
	return tunnel.Close, nil
}
