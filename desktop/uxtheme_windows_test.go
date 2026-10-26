package main

import (
	"testing"

	"golang.org/x/sys/windows"
)

func TestUXThemeIsStillLoadedAfterWailsInitialised(t *testing.T) {
	var h windows.Handle
	name := windows.StringToUTF16Ptr("uxtheme.dll")
	if err := windows.GetModuleHandleEx(windows.GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, name, &h); err != nil {
		t.Fatalf("uxtheme.dll was unloaded, so the first window would crash: %v", err)
	}
}
