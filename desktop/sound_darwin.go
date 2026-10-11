//go:build darwin

package main

import "github.com/wailsapp/wails/v3/pkg/services/notifications"

// sound names the chime scripts/desktop.mjs puts under Contents/Library/Sounds,
// where macOS looks for a notification's own sound.
func sound() *notifications.NotificationSound {
	return &notifications.NotificationSound{Name: "ArrowLoop.wav"}
}

func ring() {}
