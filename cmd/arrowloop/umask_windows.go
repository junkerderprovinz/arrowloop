//go:build windows

package main

import "fmt"

// Windows has no umask. A file created there takes the inheritable ACLs of the
// folder it lands in, which is the thing the mask exists to arrange on Unix.
//
// Asking for one anyway is answered rather than ignored: a setting that is
// quietly dropped is worse than one that is refused, because the person who set
// it goes on believing it took effect.
func applyUmask(spec string) error {
	if spec == "" {
		return nil
	}
	return fmt.Errorf("ARROWLOOP_UMASK is a Unix setting and does nothing on Windows; a new file inherits its folder's permissions here")
}

func umaskSetting() string { return "" }
