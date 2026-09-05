// Package boot prints what a container log is expected to show at startup.
//
// The shape is shared across every own-image container in this stable: the
// brand art, a name-and-subtitle line, and then one loud green READY line as
// the very last thing before the process starts listening. The point of the
// READY line is that somebody reading a log in Unraid's own viewer can tell at
// a glance whether the thing came up, without knowing anything about it.
package boot

import (
	_ "embed"
	"fmt"
	"strings"
)

//go:embed banner.txt
var art string

// Version is stamped at build time with the release tag. It stays "dev" for an
// unstamped local build, which is worth seeing in a log: a container that says
// "dev" is not the one the release notes describe.
var Version = "dev"

const (
	name     = "ReeveRoll"
	subtitle = "two-way file synchronisation"
)

func versionTag() string {
	if Version == "" || Version == "dev" {
		return " (dev)"
	}
	return " " + Version
}

// Banner prints the brand art and the name line.
func Banner() {
	fmt.Println()
	fmt.Println(strings.TrimRight(art, "\n"))
	fmt.Println()
	fmt.Println("  " + name + versionTag() + " · " + subtitle)
	fmt.Println()
}

// Ready prints the one line a log reader is looking for, and is always the last
// thing printed before the process blocks.
func Ready(url string) {
	fmt.Printf("  \033[0;32m✓ REEVEROLL%s IS READY\033[0m - Open the WebUI now (%s)\n", versionTag(), url)
	fmt.Println()
}
