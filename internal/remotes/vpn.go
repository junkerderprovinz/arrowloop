package remotes

import (
	"context"
	"errors"
	"io"
	"net"
	"net/url"
	"sync"
	"time"

	_ "github.com/rclone/rclone/backend/ftp"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
	"github.com/rclone/rclone/lib/proxy"

	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// dialers are the backends that open their connections themselves rather
// than through rclone's HTTP client, and take a proxy as a setting of theirs.
var dialers = []string{"sftp", "ftp"}

func init() {
	for _, backend := range dialers {
		wrap(backend, func(next newFs) newFs {
			return func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
				if proxy := vpnconn.ProxyOf(ctx); proxy != "" {
					m = overridden{Mapper: m, values: map[string]string{"http_proxy": proxy}}
				}
				return next(ctx, name, root, m)
			}
		})
	}
	wrap("smb", throughRelay)
}

type newFs = func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error)

// wrap puts f in front of the backend's NewFs, which f is handed as next.
func wrap(backend string, f func(next newFs) newFs) {
	info, err := rclonefs.Find(backend)
	if err != nil {
		panic(err)
	}
	info.NewFs = f(info.NewFs)
}

// throughRelay points an SMB target of a run through the VPN at a relay.
func throughRelay(next newFs) newFs {
	return func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
		if vpnconn.ProxyOf(ctx) == "" {
			return next(ctx, name, root, m)
		}
		host, _ := m.Get("host")
		port, _ := m.Get("port")
		addr, err := relayTo(ctx, net.JoinHostPort(host, port))
		if err != nil {
			return nil, err
		}
		local, localPort, _ := net.SplitHostPort(addr)
		return next(ctx, name, root, overridden{Mapper: m, values: map[string]string{"host": local, "port": localPort}})
	}
}

// overridden answers some keys with values of its own and passes the rest on.
type overridden struct {
	configmap.Mapper
	values map[string]string
}

func (o overridden) Get(key string) (string, bool) {
	if v, ok := o.values[key]; ok {
		return v, true
	}
	return o.Mapper.Get(key)
}

// errTunnelDown is a connection asked for once the run's tunnel is gone.
var errTunnelDown = errors.New("the VPN is down")

// A relay is a port on loopback that stands for one server behind a run's
// proxy, for SMB, which dials host and port itself and takes no proxy. It
// reaches the server only through the proxy and closes with the tunnel.
type relay struct {
	ln     net.Listener
	via    *url.URL
	target string
}

var relays struct {
	mu   sync.Mutex
	open map[string]*relay // by proxy and target
}

// relayTo returns the loopback address that reaches target through the run's
// proxy, starting a relay for it the first time.
func relayTo(ctx context.Context, target string) (string, error) {
	gone := vpnconn.Gone(ctx)
	select {
	case <-gone:
		return "", errTunnelDown
	default:
	}
	via, err := url.Parse(vpnconn.ProxyOf(ctx))
	if err != nil {
		return "", err
	}
	key := via.String() + " " + target
	relays.mu.Lock()
	defer relays.mu.Unlock()
	if r, ok := relays.open[key]; ok {
		return r.ln.Addr().String(), nil
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	r := &relay{ln: ln, via: via, target: target}
	if relays.open == nil {
		relays.open = map[string]*relay{}
	}
	relays.open[key] = r
	go r.serve()
	if gone != nil {
		go func() {
			<-gone
			relays.mu.Lock()
			delete(relays.open, key)
			relays.mu.Unlock()
			ln.Close()
		}()
	}
	return ln.Addr().String(), nil
}

// relayWait bounds reaching the server through the proxy.
const relayWait = time.Minute

func (r *relay) serve() {
	for {
		c, err := r.ln.Accept()
		if err != nil {
			return
		}
		go r.pass(c)
	}
}

// pass carries one connection to the server. The proxy ends its side when
// the tunnel goes down, which ends this one too.
func (r *relay) pass(c net.Conn) {
	defer c.Close()
	server, err := proxy.HTTPConnectDial("tcp", r.target, r.via, &net.Dialer{Timeout: relayWait})
	if err != nil {
		rclonefs.Errorf(nil, "smb: %s through the VPN: %v", r.target, err)
		return
	}
	defer server.Close()
	pipe(c, server)
}

// pipe passes traffic both ways until either side is done. The caller closes
// both, which ends the other direction.
func pipe(a, b net.Conn) {
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(a, b); done <- struct{}{} }()
	go func() { _, _ = io.Copy(b, a); done <- struct{}{} }()
	<-done
}
