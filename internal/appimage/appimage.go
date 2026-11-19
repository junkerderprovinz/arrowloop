// Package appimage tells whether the program runs from an AppImage. The
// AppImage runtime mounts the file read-only and starts the program from inside
// the mount, which is gone once the program quits, so whatever has to outlive
// the run names the AppImage file instead.
package appimage

import "os"

// Path returns the AppImage file the program runs from, or "" outside one. The
// runtime sets APPIMAGE for every program it starts.
func Path() string { return os.Getenv("APPIMAGE") }
