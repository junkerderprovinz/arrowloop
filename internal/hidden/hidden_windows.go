//go:build windows

package hidden

import "golang.org/x/sys/windows"

// Folder sets the hidden attribute on dir if it exists. A folder that cannot
// be hidden, such as one on a share that refuses attributes, stays visible.
func Folder(dir string) {
	p, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return
	}
	attrs, err := windows.GetFileAttributes(p)
	if err != nil || attrs&windows.FILE_ATTRIBUTE_HIDDEN != 0 {
		return
	}
	_ = windows.SetFileAttributes(p, attrs|windows.FILE_ATTRIBUTE_HIDDEN)
}
