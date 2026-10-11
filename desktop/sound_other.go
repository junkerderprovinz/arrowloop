//go:build !windows && !darwin

package main

import "github.com/wailsapp/wails/v3/pkg/services/notifications"

// sound asks the notification daemon for the warning sound of the desktop's
// sound theme. The freedesktop protocol has no way to hand over a file of our
// own that every daemon plays.
func sound() *notifications.NotificationSound {
	return &notifications.NotificationSound{Name: "dialog-warning"}
}

func ring() {}
