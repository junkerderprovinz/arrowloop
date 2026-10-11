//go:build windows

package main

import (
	_ "embed"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// A toast from a program that is not a packaged app can only play the sounds
// Windows ships, so the toast stays silent and ArrowLoop plays its own.
//
//go:embed build/sounds/ArrowLoop.wav
var chime []byte

var (
	procQueryNotificationState = windows.NewLazySystemDLL("shell32.dll").NewProc("SHQueryUserNotificationState")
	procPlaySound              = windows.NewLazySystemDLL("winmm.dll").NewProc("PlaySoundW")
)

const (
	quunsAcceptsNotifications = 5

	sndAsync     = 0x0001
	sndNoDefault = 0x0002
	sndMemory    = 0x0004
)

func sound() *notifications.NotificationSound {
	return &notifications.NotificationSound{Silent: true}
}

// ring plays the chime unless Windows would have kept the toast quiet: do not
// disturb, a full-screen program or a presentation, notifications switched off
// for everything or for ArrowLoop alone.
func ring() {
	var state int32
	if hr, _, _ := procQueryNotificationState.Call(uintptr(unsafe.Pointer(&state))); hr != 0 || state != quunsAcceptsNotifications {
		return
	}
	if switchedOff(`Software\Microsoft\Windows\CurrentVersion\PushNotifications`, "ToastEnabled") ||
		switchedOff(`Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\ArrowLoop`, "Enabled") {
		return
	}
	procPlaySound.Call(uintptr(unsafe.Pointer(&chime[0])), 0, sndMemory|sndAsync|sndNoDefault)
}

// switchedOff reports whether a settings value is present and zero. Windows
// writes these only once somebody turns the switch.
func switchedOff(path, name string) bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	v, _, err := key.GetIntegerValue(name)
	return err == nil && v == 0
}
