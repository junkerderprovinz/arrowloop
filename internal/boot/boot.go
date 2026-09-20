// Package boot prints the startup banner of the container log: the brand art, a
// name line, and a green READY line as the last thing before the process starts
// listening, so a reader of Unraid's log viewer can see at a glance that it
// came up.
package boot

import (
	_ "embed"
	"fmt"
	"strings"
)

//go:embed banner.txt
var art string

// Version is stamped at build time with the release tag and stays "dev" for a
// local build.
var Version = "dev"

const (
	name     = "ArrowLoop"
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

// Ready prints the line a log reader looks for. It is the last thing printed
// before the process blocks.
func Ready(url string) {
	fmt.Printf("  \033[0;32m✓ ARROWLOOP%s IS READY\033[0m - Open the WebUI now (%s)\n", versionTag(), url)
	fmt.Println()
}
