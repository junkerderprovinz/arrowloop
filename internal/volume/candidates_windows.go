//go:build windows

package volume

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// platformCandidates lists the drive roots a marked volume could be sitting on.
//
// Every attached letter is offered, including network drives: a mapped share is
// exactly the case this package exists for, since the letter it gets depends on
// what was already taken when it was connected.
//
// The system's own error dialog is suppressed for the duration. Without that,
// touching an empty optical drive pops a modal box on the user's desktop from a
// background service, which is a memorable way to discover this code exists.
func platformCandidates() []string {
	previous := windows.SetErrorMode(windows.SEM_FAILCRITICALERRORS)
	defer windows.SetErrorMode(previous)

	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil
	}

	var out []string
	for letter := 'A'; letter <= 'Z'; letter++ {
		if mask&(1<<uint(letter-'A')) == 0 {
			continue
		}
		root := fmt.Sprintf("%c:\\", letter)
		// A letter can be present in the mask and still be a card reader with
		// no card in it, so ask before offering it.
		if _, err := os.Stat(root); err != nil {
			continue
		}
		out = append(out, root)
	}
	return out
}
