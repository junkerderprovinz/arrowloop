// Package flatpak tells whether the program runs inside a Flatpak sandbox. There
// the software centre updates it, the program's own files are read-only, and the
// session's autostart directory is reached through a portal.
package flatpak

import "os"

// ID returns the application ID the program runs under inside a Flatpak, or ""
// outside one. Flatpak sets FLATPAK_ID for every program it starts.
func ID() string { return os.Getenv("FLATPAK_ID") }
