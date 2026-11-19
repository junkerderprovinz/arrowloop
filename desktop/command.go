package main

import (
	"fmt"
	"io"

	"github.com/rclone/rclone/fs/config"

	"github.com/junkerderprovinz/arrowloop/internal/cli"
)

// isCommand reports whether the program was started with one of the engine's
// commands first, which it runs instead of opening the window. Flags of its
// own, such as --tray, still open the window.
func isCommand(args []string) bool {
	return len(args) > 0 && cli.IsCommand(args[0])
}

// command runs one of the engine's commands on the window's own
// configuration, so `ArrowLoop run Fotos` needs no -config. It touches nothing
// the window owns: no window, no tray icon, no single-instance lock that would
// bring a running copy forward. A job that copy is running is left to it (see
// package joblock).
func command(args []string, stdout, stderr io.Writer) int {
	path, err := configLocation("")
	if err != nil {
		fmt.Fprintln(stderr, "error:", err)
		return 1
	}
	return cli.Main(args, cli.Options{Config: path, Remotes: useRcloneConfig, Stdout: stdout, Stderr: stderr})
}

// useRcloneConfig points rclone at the configuration rcloneConfig names for
// the engine's configuration at configPath.
func useRcloneConfig(configPath string) error {
	if path := rcloneConfig(configPath); path != "" {
		return config.SetConfigPath(path)
	}
	return nil
}
