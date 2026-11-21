package vpnconn

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
)

type routeKey struct{}

// route is where a run's connections go: the proxy, and a channel that closes
// once the tunnel behind it is down.
type route struct {
	proxy string
	gone  <-chan struct{}
}

// Context carries the run's settings with every connection rclone makes sent
// to the tunnel's proxy. The SFTP, FTP and SMB backends dial for themselves
// and read the proxy from ProxyOf (see internal/remotes).
func (l *Lease) Context(ctx context.Context) context.Context {
	proxy := l.Proxy()
	ctx, ci := rclonefs.AddConfig(Through(ctx, proxy, l.b.px.gone))
	ci.HTTPProxy = proxy
	return ctx
}

// Through marks ctx as a run's whose connections go through proxy, until gone
// closes. A nil gone never closes.
func Through(ctx context.Context, proxy string, gone <-chan struct{}) context.Context {
	return context.WithValue(ctx, routeKey{}, route{proxy: proxy, gone: gone})
}

// ProxyOf is the proxy a run's connections go through to reach the tunnel,
// "" for a run that does not go through the VPN.
func ProxyOf(ctx context.Context) string {
	r, _ := ctx.Value(routeKey{}).(route)
	return r.proxy
}

// Gone closes once the tunnel behind ProxyOf's proxy is down, and is nil when
// ctx does not know.
func Gone(ctx context.Context) <-chan struct{} {
	r, _ := ctx.Value(routeKey{}).(route)
	return r.gone
}

// routable are the backends whose every connection follows the run's proxy:
// they build their HTTP clients from the run's settings, or dial through the
// proxy they are given. The others keep a client of the whole process or dial
// past it, so a job of theirs cannot promise to stay inside the tunnel.
var routable = []string{
	"b2", "box", "cloudinary", "doi", "dosya", "drime", "drive", "dropbox",
	"filefabric", "filelu", "filescom", "ftp", "gofile", "googlecloudstorage",
	"googlephotos", "hidrive", "http", "huaweidrive", "iclouddrive",
	"internetarchive", "internxt", "jottacloud", "kdrive", "koofr", "linkbox",
	"mailru", "mega", "netstorage", "onedrive", "opendrive",
	"oracleobjectstorage", "pcloud", "pikpak", "pixeldrain", "premiumizeme",
	"putio", "qingstor", "quatrix", "s3", "seafile", "sftp", "shade",
	"sharefile", "sia", "smb", "sugarsync", "ulozto", "webdav", "yandex",
	"zoho",
}

// offline are the backends that make no connection of their own.
var offline = []string{"local", "memory"}

// Offline reports whether a side makes no connection of its own, such as a
// folder on this machine, so it needs no tunnel to be read.
func Offline(remote string) bool {
	info, _, _, _, err := rclonefs.ParseRemote(remote)
	return err == nil && slices.Contains(offline, info.Name)
}

// Unroutable says why a side cannot go through the VPN, nil when it can. Each
// case is a way a connection would leave past the tunnel.
func Unroutable(remote string) error {
	info, name, _, conn, err := rclonefs.ParseRemote(remote)
	if err != nil {
		return err
	}
	if slices.Contains(offline, info.Name) {
		return nil
	}
	if !slices.Contains(routable, info.Name) {
		return fmt.Errorf("a %s target cannot go through the VPN, since it makes connections the VPN cannot carry", info.Name)
	}
	opt := rclonefs.ConfigMap(info.Prefix, info.Options, name, conn)
	get := func(key string) string {
		v, _ := opt.Get(key)
		return strings.TrimSpace(v)
	}
	switch info.Name {
	case "sftp":
		// An outside ssh command and a SOCKS proxy both dial for
		// themselves; rclone takes either before an HTTP proxy.
		if get("ssh") != "" {
			return fmt.Errorf("an SFTP target that connects with its own ssh command cannot go through the VPN")
		}
		if get("socks_proxy") != "" {
			return fmt.Errorf("an SFTP target with a SOCKS proxy of its own cannot go through the VPN")
		}
	case "ftp":
		if get("socks_proxy") != "" {
			return fmt.Errorf("an FTP target with a SOCKS proxy of its own cannot go through the VPN")
		}
	case "smb":
		// The Kerberos library asks the domain controller for tickets with
		// connections of its own.
		if b, _ := strconv.ParseBool(get("use_kerberos")); b {
			return fmt.Errorf("an SMB target that signs in with Kerberos cannot go through the VPN")
		}
	case "s3":
		// rclone asks IDrive for the endpoint with a client of its own.
		if strings.EqualFold(get("provider"), "IDrive") {
			return fmt.Errorf("an IDrive e2 target cannot go through the VPN")
		}
	case "webdav":
		// SharePoint's sign-in cookies are fetched with a client of its own.
		if strings.EqualFold(get("vendor"), "sharepoint") {
			return fmt.Errorf("a SharePoint target cannot go through the VPN")
		}
	}
	return nil
}
