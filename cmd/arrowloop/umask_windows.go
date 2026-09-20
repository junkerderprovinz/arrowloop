//go:build windows

package main

import "fmt"

// applyUmask refuses a mask on Windows, where a new file inherits its folder's
// ACLs, rather than ignore it silently.
func applyUmask(spec string) error {
	if spec == "" {
		return nil
	}
	return fmt.Errorf("ARROWLOOP_UMASK is a Unix setting and does nothing on Windows; a new file inherits its folder's permissions here")
}

func umaskSetting() string { return "" }
