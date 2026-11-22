package vpn

import (
	"sync"

	"golang.zx2c4.com/wireguard/conn"
)

// openBind is the UDP side of a new device; tests stand in for the system.
var openBind = func() conn.Bind { return bindFor(canFollowRoutes()) }

var canFollowRoutes = sync.OnceValue(routeSocketAllowed)

// unfollowedBind is wireguard-go's own bind under another type. On Linux the
// device opens a netlink socket to follow route changes for a
// *conn.StdNetBind, and does not come up when that is refused, as Android
// refuses it to an app. The tunnel gets a new socket on every reconnect, so it
// follows a network the system moved to all the same.
type unfollowedBind struct{ conn.Bind }

func bindFor(followRoutes bool) conn.Bind {
	if followRoutes {
		return conn.NewDefaultBind()
	}
	return unfollowedBind{conn.NewDefaultBind()}
}
