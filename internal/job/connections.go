package job

import (
	_ "github.com/rclone/rclone/backend/ftp"
	rclonefs "github.com/rclone/rclone/fs"
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
