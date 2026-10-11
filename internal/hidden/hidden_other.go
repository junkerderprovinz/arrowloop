//go:build !windows

package hidden

// Folder does nothing: the folder's leading dot hides it.
func Folder(string) {}
