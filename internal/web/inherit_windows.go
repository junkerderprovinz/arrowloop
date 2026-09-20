//go:build windows

package web

// inheritFrom does nothing on Windows, where a new directory picks up its
// parent's inheritable ACLs by itself.
func inheritFrom(parent, made string) {}
