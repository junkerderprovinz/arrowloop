// Command arrowloop synchronises two folders in both directions; package cli
// has the commands.
package main

import (
	"os"

	// Every backend rclone carries, so the interface can offer whatever is
	// compiled in. It roughly doubles the size of the binary.
	_ "github.com/rclone/rclone/backend/all"

	"github.com/junkerderprovinz/arrowloop/internal/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:], cli.Engine()))
}
