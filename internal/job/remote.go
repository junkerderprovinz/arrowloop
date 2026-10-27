package job

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"path"
	"slices"
	"strings"

	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/fspath"
)

// identity is what tells one target of a backend from another: the settings
// that pick out the server and the account on it, without the credentials. A
// backend missing from identities cannot be placed from its settings, since
// two of its targets may reach two accounts that are written down the same
// way.
type identity struct {
	keys []string
	// account is the settings that pick the account on the server.
	account []string
	// signIn is set where an account left unnamed is whichever one the
	// credentials sign in to. Credentials are not compared, so such a target
	// is never taken for another.
	signIn bool
	// needs is the settings of which at least one has to be set, such as the
	// drive's id, without which the account is not known.
	needs []string
	// home is set where a path without a leading slash starts in the user's
	// home folder, which the settings do not name.
	home bool
	// fold is set where the backend does not tell case apart.
	fold bool
}

var identities = map[string]identity{
	"sftp":        {keys: []string{"host", "port"}, account: []string{"user"}, needs: []string{"host"}, home: true},
	"ftp":         {keys: []string{"host", "port"}, account: []string{"user"}, needs: []string{"host"}, home: true},
	"smb":         {keys: []string{"host", "port"}, account: []string{"user", "domain"}, needs: []string{"host"}, fold: true},
	"webdav":      {keys: []string{"url"}, account: []string{"user"}, signIn: true, needs: []string{"url"}},
	"http":        {keys: []string{"url"}, needs: []string{"url"}},
	"s3":          {keys: []string{"endpoint"}, account: []string{"access_key_id"}, signIn: true},
	"gcs":         {keys: []string{"endpoint"}},
	"b2":          {keys: []string{"endpoint"}},
	"azureblob":   {keys: []string{"account", "endpoint"}, needs: []string{"account", "endpoint"}},
	"azurefiles":  {keys: []string{"account", "share_name", "endpoint"}, needs: []string{"account", "endpoint"}, fold: true},
	"swift":       {keys: []string{"auth", "region", "storage_url"}, account: []string{"user", "user_id", "application_credential_id", "domain", "tenant", "tenant_id", "tenant_domain"}, signIn: true, needs: []string{"auth", "storage_url"}},
	"onedrive":    {keys: []string{"drive_id"}, needs: []string{"drive_id"}, fold: true},
	"drive":       {keys: []string{"team_drive", "root_folder_id"}, needs: []string{"team_drive", "root_folder_id"}},
	"mega":        {keys: []string{"user"}, needs: []string{"user"}},
	"protondrive": {keys: []string{"username"}, needs: []string{"username"}},
	"seafile":     {keys: []string{"url", "library"}, account: []string{"user"}, signIn: true, needs: []string{"url"}},
	"hdfs":        {keys: []string{"namenode"}, account: []string{"username"}, needs: []string{"namenode"}},
	"memory":      {},
}

// place is where a side points: a folder on this machine, or a target named by
// its backend and identifying settings and a path there.
type place struct {
	local   string
	target  string
	account string
	path    string
	// fromHome is set for a path that starts in the user's home folder.
	fromHome bool
	// unnamed is set for a target whose account only its credentials know.
	unnamed bool
}

// OnNetwork reports whether a side of the job lies off this machine, so that
// the job cannot run without a network. A side that cannot be placed counts as
// off it.
func (j Job) OnNetwork() bool {
	for _, side := range []string{j.Left, j.Right} {
		if p, err := locate(side); err != nil || p.local == "" {
			return true
		}
	}
	return false
}

// locate works out where a side points from rclone's configuration, without
// connecting. A side whose target is not configured, is of a backend this
// build lacks, or does not name its account cannot be placed.
func locate(side string) (place, error) {
	side = strings.TrimSpace(side)
	// Eight aliases in a row is more than anybody chains on purpose, and
	// stops one that points at itself.
	for range 8 {
		parsed, err := fspath.Parse(side)
		if err != nil {
			return place{}, err
		}
		if parsed.Name == "" {
			return place{local: parsed.Path}, nil
		}
		info, _, at, cfg, err := rclonefs.ConfigFs(side)
		if err != nil {
			return place{}, err
		}
		get := func(key string) string {
			v, _ := cfg.Get(key)
			return strings.TrimSpace(v)
		}
		switch info.Name {
		case "local":
			return place{local: at}, nil
		case "alias":
			target := get("remote")
			if target == "" {
				return place{}, fmt.Errorf("the alias %s does not say what it stands for", parsed.Name)
			}
			side = fspath.JoinRootPath(target, at)
		default:
			return identify(parsed.Name, info.Name, at, get)
		}
	}
	return place{}, errors.New("the aliases lead round in a circle")
}

// identify places a target of a backend by its settings, read through get.
func identify(name, backend, at string, get func(string) string) (place, error) {
	id, ok := identities[backend]
	if !ok {
		return place{}, fmt.Errorf("%s targets cannot be told apart by their settings", backend)
	}
	if len(id.needs) > 0 && !slices.ContainsFunc(id.needs, func(k string) bool { return get(k) != "" }) {
		return place{}, fmt.Errorf("the target %s does not say which %s it reaches", name, strings.Join(id.needs, " or "))
	}

	p := place{path: at}
	var b strings.Builder
	b.WriteString(backend)
	for _, key := range id.keys {
		v := get(key)
		switch key {
		case "host":
			v = strings.ToLower(v)
		case "url":
			// The path in the address and the path after it are one path.
			base, sub, err := splitURL(v)
			if err != nil {
				return place{}, err
			}
			v = base
			p.path = sub + "/" + p.path
		case "endpoint":
			e, err := endpoint(backend, get("provider"), v)
			if err != nil {
				return place{}, fmt.Errorf("the target %s: %w", name, err)
			}
			v = e
		}
		b.WriteString(" " + key + "=" + v)
	}
	p.target = b.String()
	b.Reset()
	for _, key := range id.account {
		b.WriteString(" " + key + "=" + get(key))
	}
	p.account = b.String()
	p.unnamed = id.signIn && !slices.ContainsFunc(id.account, func(k string) bool { return get(k) != "" })

	p.fromHome = id.home && !strings.HasPrefix(p.path, "/")
	p.path = strings.Trim(path.Clean("/"+strings.ReplaceAll(p.path, `\`, "/")), "/")
	if id.fold {
		p.path = strings.ToLower(p.path)
	}
	return p, nil
}

// splitURL parts an address into the server, with case and a default port
// taken out, and the path on it.
func splitURL(raw string) (base, sub string, err error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "", fmt.Errorf("cannot read the address %q", raw)
	}
	scheme := strings.ToLower(u.Scheme)
	host, port := strings.ToLower(u.Hostname()), u.Port()
	if scheme == "https" && port == "443" || scheme == "http" && port == "80" {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	}
	return scheme + "://" + host, u.Path, nil
}

// endpoint names the server a bucket target reaches. AWS buckets share one
// namespace, so every AWS address is the same server; another provider has to
// give its address.
func endpoint(backend, provider, v string) (string, error) {
	v = strings.ToLower(v)
	if i := strings.Index(v, "://"); i >= 0 {
		v = v[i+3:]
	}
	v = strings.TrimRight(v, "/")
	if backend != "s3" {
		return v, nil
	}
	if provider == "" || strings.EqualFold(provider, "AWS") {
		if v == "" || strings.HasSuffix(v, ".amazonaws.com") {
			return "amazonaws.com", nil
		}
		return v, nil
	}
	if v == "" {
		return "", errors.New("it does not give its endpoint")
	}
	return v, nil
}

// match reports whether two places are one, and whether that is known. A path
// from the home folder against one from the root cannot be settled without
// asking the server where home is, and an account only the credentials name
// cannot be settled at all.
func (a place) match(b place) (same, known bool) {
	if a.local != "" || b.local != "" {
		if a.local == "" || b.local == "" {
			return false, true
		}
		if SamePlace(a.local, b.local) {
			return true, true
		}
		return false, localApart(a.local, b.local)
	}
	if a.target != b.target {
		return false, true
	}
	if a.unnamed || b.unnamed {
		return false, false
	}
	if a.account != b.account {
		return false, true
	}
	if a.fromHome != b.fromHome {
		return false, false
	}
	return a.path == b.path, true
}

// atShareList reports whether a side is the top of an SMB server, which is the
// list of the server's shares. Only the server makes a share, so a job has
// nothing to write there.
func atShareList(side string) bool {
	p, err := locate(side)
	return err == nil && strings.HasPrefix(p.target, "smb ") && p.path == ""
}
