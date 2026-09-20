//go:build windows

package volume

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

// platformCandidates lists the drive roots a marked volume could be sitting on,
// network drives included. The system error dialog is suppressed, or an empty
// optical drive would pop up a modal box.
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
		// A letter in the mask can be a card reader without a card.
		if _, err := os.Stat(root); err != nil {
			continue
		}
		out = append(out, root)
	}
	return out
}
