package main

import (
	"log"

	"golang.org/x/sys/windows"
)

// releaseWebview trims this process's working set once the last window has
// gone. WebView2 ends its own processes with that window, but the pages its
// loader and the graphics driver touched here stay resident until Windows runs
// short.
func releaseWebview() {
	// Both sizes at -1 ask for as many pages as Windows can take.
	if err := windows.SetProcessWorkingSetSizeEx(windows.CurrentProcess(), ^uintptr(0), ^uintptr(0), 0); err != nil {
		log.Printf("could not trim the working set: %v", err)
	}
}
