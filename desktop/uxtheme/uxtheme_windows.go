package uxtheme

import "golang.org/x/sys/windows"

func init() {
	// Never freed, so Wails' FreeLibrary can no longer drop the last reference.
	windows.LoadLibrary("uxtheme.dll")
}
