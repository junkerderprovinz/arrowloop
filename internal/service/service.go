// Package service writes the file each operating system wants in order to keep
// a program running in the background, and the command that installs it.
//
// It installs nothing itself: registering a service writes outside the user's
// files and on some systems needs administrative rights, which a sync tool
// should not take on quietly.
package service

import (
	"fmt"
	"runtime"
	"strings"
)

// Definition is what to write where, and how to switch it on.
type Definition struct {
	// Path is where the file belongs. Empty on Windows, which has no file.
	Path string
	// Content is the file to write. Empty on Windows.
	Content string
	// Install is the command that registers the service once the file is in
	// place.
	Install string
	// Notes are caveats printed after the command.
	Notes []string
}

// For builds the definition for one platform, which need not be the current
// one.
func For(goos, exe, config string) (Definition, error) {
	switch goos {
	case "linux":
		return linux(exe, config), nil
	case "darwin":
		return darwin(exe, config), nil
	case "windows":
		return windows(exe, config), nil
	}
	return Definition{}, fmt.Errorf("no service definition for %s", goos)
}

// Current builds the definition for the machine this is running on.
func Current(exe, config string) (Definition, error) { return For(runtime.GOOS, exe, config) }

func linux(exe, config string) Definition {
	unit := fmt.Sprintf(`[Unit]
Description=ArrowLoop file synchronisation
Documentation=https://github.com/junkerderprovinz/arrowloop
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s daemon -config %s
Restart=on-failure
RestartSec=30

# The daemon only ever needs the folders its jobs name, so it is given nothing
# else. If a job syncs somewhere outside the home directory, add that path to
# ReadWritePaths or this will fail with a permission error that has nothing to
# do with the remote.
ProtectSystem=strict
ProtectHome=read-write
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=default.target
`, exe, config)

	return Definition{
		Path:    "~/.config/systemd/user/arrowloop.service",
		Content: unit,
		Install: "systemctl --user daemon-reload && systemctl --user enable --now arrowloop",
		Notes: []string{
			"This is a user service, so it needs no root and stops when the user logs out.",
			"To keep it running while nobody is logged in: sudo loginctl enable-linger $USER",
			"Follow it with: journalctl --user -u arrowloop -f",
		},
	}
}

func darwin(exe, config string) Definition {
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.junkerderprovinz.arrowloop</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>daemon</string>
		<string>-config</string>
		<string>%s</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>/tmp/arrowloop.log</string>
	<key>StandardErrorPath</key>
	<string>/tmp/arrowloop.log</string>
</dict>
</plist>
`, exe, config)

	return Definition{
		Path:    "~/Library/LaunchAgents/com.junkerderprovinz.arrowloop.plist",
		Content: plist,
		Install: "launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.junkerderprovinz.arrowloop.plist",
		Notes: []string{
			"macOS asks for permission the first time the agent touches Desktop, Documents or Downloads. Until that is granted the job fails with an ordinary permission error, which looks like a bug and is not one.",
			"To stop it: launchctl bootout gui/$(id -u)/com.junkerderprovinz.arrowloop",
		},
	}
}

func windows(exe, config string) Definition {
	// sc.exe needs the space after binPath=, and the whole command as one
	// quoted string when the paths contain spaces.
	install := fmt.Sprintf(`sc.exe create ArrowLoop binPath= "\"%s\" daemon -config \"%s\"" start= auto DisplayName= "ArrowLoop file synchronisation"`, exe, config)

	return Definition{
		Install: install,
		Notes: []string{
			"Run this in an elevated prompt; sc.exe cannot create a service without administrative rights.",
			"A Windows service runs as LocalSystem by default, which has no mapped network drives and no user profile. A job pointing at a UNC path such as \\\\server\\share works; one pointing at Z:\\ does not.",
			"LocalSystem also runs the jobs' before and after commands. Point the service at the installed program under Program Files and at a configuration file an administrator created, not one in a user's profile: whoever can change either file can run anything as LocalSystem.",
			"Start it with: sc.exe start ArrowLoop, and remove it with: sc.exe delete ArrowLoop",
			"This binary is not a native Windows service yet: it runs as an ordinary program under the service manager, so the Services panel will show it as running but stopping it is a kill rather than a clean shutdown.",
		},
	}
}

// String renders the definition the way the command line prints it.
func (d Definition) String() string {
	var b strings.Builder
	if d.Path != "" {
		fmt.Fprintf(&b, "Write this to %s:\n\n%s\n", d.Path, d.Content)
	}
	fmt.Fprintf(&b, "Then run:\n\n  %s\n", d.Install)
	if len(d.Notes) > 0 {
		b.WriteString("\nWorth knowing:\n")
		for _, n := range d.Notes {
			fmt.Fprintf(&b, "  - %s\n", n)
		}
	}
	return b.String()
}
