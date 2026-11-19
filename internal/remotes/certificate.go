package remotes

import (
	"context"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/certpin"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
	_ "github.com/rclone/rclone/backend/webdav"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
)

// CertificateKey is the setting that holds the fingerprint of the one
// certificate a target trusts although no authority vouches for it, the way
// a self-hosted Nextcloud's own certificate is trusted. rclone ignores it.
const CertificateKey = "trusted_certificate"

// pinnable are the backends whose HTTP connections a pin can reach.
var pinnable = []string{"webdav"}

func init() {
	for _, backend := range pinnable {
		info, err := rclonefs.Find(backend)
		if err != nil {
			panic(err)
		}
		open := info.NewFs
		info.NewFs = func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
			pin, _ := m.Get(CertificateKey)
			ctx, err := throughPin(ctx, strings.TrimSpace(pin))
			if err != nil {
				return nil, err
			}
			return open(ctx, name, root, m)
		}
	}
}

// throughPin sends the connections of a target made with ctx through the
// relay that holds them to pin. A run that goes through the VPN has the relay
// reach the server through the tunnel's proxy.
func throughPin(ctx context.Context, pin string) (context.Context, error) {
	ci := rclonefs.GetConfig(ctx)
	// With every check off already, a pin would only check more.
	if pin == "" || ci.InsecureSkipVerify {
		return ctx, nil
	}
	proxy, authority, err := certpin.Relay(pin, ci.CaCert, vpnconn.ProxyOf(ctx))
	if err != nil {
		return nil, err
	}
	ctx, routed := rclonefs.AddConfig(ctx)
	routed.HTTPProxy = proxy
	routed.CaCert = []string{authority}
	return ctx, nil
}
