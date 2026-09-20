//go:build !windows

package main

import (
	"fmt"
	"os"
	"strconv"
	"syscall"
)

// applyUmask sets the file-creation mask for everything this process writes.
//
// A container writing into an Unraid share runs as root with umask 022, so
// every copied file and folder would be read-only for the share's owner.
// rclone does the copying, so the mask is the one setting that covers every
// file it creates. Empty leaves the mask alone, as a desktop install wants;
// the container image sets 000.
func applyUmask(spec string) error {
	if spec == "" {
		return nil
	}
	mask, err := strconv.ParseUint(spec, 8, 32)
	if err != nil || mask > 0o777 {
		return fmt.Errorf("ARROWLOOP_UMASK=%q is not an octal mask such as 000 or 022", spec)
	}
	syscall.Umask(int(mask))
	return nil
}

// umaskSetting is the mask this process was asked for, or "".
func umaskSetting() string { return os.Getenv("ARROWLOOP_UMASK") }
