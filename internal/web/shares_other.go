//go:build !windows

package web

// connectedShares finds none: a server or a container mounts its shares
// itself, and they appear in the folder picker as ordinary folders.
func connectedShares() ([]share, error) {
	return nil, nil
}
