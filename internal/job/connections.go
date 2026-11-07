package job

import (
	"strconv"
	"strings"
	"sync"

	_ "github.com/rclone/rclone/backend/ftp"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config/configmap"
	"github.com/rclone/rclone/fs/fspath"
)

// FTPConnections is how many connections an FTP target opens at once unless
// its settings say otherwise. rclone's own default has no limit and opens one
// per folder it lists, while the FTP server apps on phones refuse a login
// beyond a handful.
const FTPConnections = 4

// The default goes into rclone's description of the backend, so a target's
// own concurrency still wins and the form shows the number as the default.
func init() {
	info := rclonefs.MustFind("ftp")
	for i := range info.Options {
		if info.Options[i].Name == "concurrency" {
			info.Options[i].Default = FTPConnections
		}
	}
}

// found holds how many connections an FTP server took once it had turned a
// login away, by server and account, since the cap belongs to the server and
// not to one target. It lasts as long as the process: finding the number
// again costs one refused login for each halving.
var found = struct {
	sync.Mutex
	at map[string]int
}{at: map[string]int{}}

// connections is how many connections an FTP target opens at once, and
// whether its own settings say so. A target that leaves the number to
// ArrowLoop gets what its server was found to take, or FTPConnections.
func connections(p place, cfg *configmap.Map) (n int, own bool) {
	if v, ok := cfg.GetPriority("concurrency", configmap.PriorityConfig); ok {
		n, _ = strconv.Atoi(strings.TrimSpace(v))
		return n, true
	}
	found.Lock()
	defer found.Unlock()
	if n, ok := found.at[p.target+p.account]; ok {
		return n, false
	}
	return FTPConnections, false
}

// ftpSide places a side on an FTP server. A side reached through an alias is
// left out, since the alias would not hand a connection setting on.
func ftpSide(side string) (fspath.Parsed, place, bool) {
	parsed, err := fspath.Parse(strings.TrimSpace(side))
	if err != nil || parsed.Name == "" {
		return parsed, place{}, false
	}
	if info, _, _, _, err := rclonefs.ConfigFs(side); err != nil || info.Name != "ftp" {
		return parsed, place{}, false
	}
	p, err := locate(side)
	return parsed, p, err == nil
}

// Narrow returns side set to open the connections its FTP server was found to
// take, or side as it is where nothing was found or its target names its own
// number.
func Narrow(side string) string {
	parsed, p, ok := ftpSide(side)
	if !ok || p.ownConnections {
		return side
	}
	found.Lock()
	n, ok := found.at[p.target+p.account]
	found.Unlock()
	if !ok {
		return side
	}
	return strings.TrimSuffix(parsed.ConfigString, ":") + ",concurrency=" + strconv.Itoa(n) + ":" + parsed.Path
}

// StepDown halves the connections a side's FTP server is opened with, after
// it turned a login away, and returns the new number. It reports false for a
// side not on an FTP server, one whose target names its own number, and one
// down to a single connection.
func StepDown(side string) (int, bool) {
	_, p, ok := ftpSide(side)
	if !ok || p.ownConnections || p.connections <= 1 {
		return 0, false
	}
	n := p.connections / 2
	found.Lock()
	found.at[p.target+p.account] = n
	found.Unlock()
	return n, true
}

// fitTransfers keeps a job's transfers below the connections either side
// takes. rclone waits for a free connection, and a transfer that holds one
// while it looks something up on the same side would otherwise wait forever.
func (j Job) fitTransfers(transfers int) int {
	for _, side := range []string{j.Left, j.Right} {
		if p, err := locate(side); err == nil && p.connections > 0 {
			transfers = min(transfers, max(p.connections-1, 1))
		}
	}
	return transfers
}
