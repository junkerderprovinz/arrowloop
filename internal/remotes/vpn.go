package remotes

import (
	"context"

	_ "github.com/rclone/rclone/backend/ftp"
	_ "github.com/rclone/rclone/backend/sftp"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"

	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// dialers are the backends that open their connections themselves rather
// than through rclone's HTTP client, and take a proxy as a setting of theirs.
var dialers = []string{"sftp", "ftp"}

func init() {
	for _, backend := range dialers {
		info, err := rclonefs.Find(backend)
		if err != nil {
			panic(err)
		}
		open := info.NewFs
		info.NewFs = func(ctx context.Context, name, root string, m configmap.Mapper) (rclonefs.Fs, error) {
			if proxy := vpnconn.ProxyOf(ctx); proxy != "" {
				m = overridden{Mapper: m, key: "http_proxy", value: proxy}
			}
			return open(ctx, name, root, m)
		}
	}
}

// overridden answers one key with a value of its own and passes the rest on.
type overridden struct {
	configmap.Mapper
	key, value string
}

func (o overridden) Get(key string) (string, bool) {
	if key == o.key {
		return o.value, true
	}
	return o.Mapper.Get(key)
}
