// Command installer installs ArrowLoop on Windows and Linux. The desktop build
// (scripts/desktop.mjs) copies the program into payload/ and builds this
// around it; on macOS the app ships as a disk image instead.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"

	"github.com/junkerderprovinz/pommelporter"
)

var (
	//go:embed payload
	payload embed.FS
	//go:embed logo.svg
	logo []byte
	//go:embed icon.png
	icon []byte
)

// Set by the build: an updatetest build installs as "ArrowLoop Test", next to
// a real installation.
var (
	name    = "ArrowLoop"
	id      = "com.junkerderprovinz.arrowloop"
	version = "0.0.0"
)

const uninstallRoot = `Software\Microsoft\Windows\CurrentVersion\Uninstall\`

func main() {
	files, err := fs.Sub(payload, "payload")
	if err == nil {
		err = pommelporter.Run(pommelporter.App{
			Name:       name,
			ID:         id,
			Executable: executable,
			Version:    version,
			Publisher:  "junkerderprovinz",
			Homepage:   "https://github.com/junkerderprovinz/arrowloop",
			Accent:     "#FCC419",
			Logo:       logo,
			Icon:       icon,
			Categories: []string{"Network", "FileTransfer"},
			Payload:    files,
			// The lock of a copy on its usual configuration, instanceID in
			// desktop/main.go, and the value internal/autostart writes. The
			// test build names both after itself.
			InstanceID: id,
			Autostart:  name,
			Legacy: pommelporter.Legacy{
				// 1.1.0 and earlier, from Wails v2's script, which ran company
				// and product together into one name.
				MachineKeys: []string{uninstallRoot + name + name},
				// 1.2.0, installed for one person under AppData\Local\Programs.
				UserKeys:   []string{uninstallRoot + name},
				ChoiceKeys: []string{`Software\` + name},
			},
		})
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
