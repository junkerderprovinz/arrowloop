//go:build windows

package web

// Windows has no POSIX owner or mode to inherit, and needs none: a new
// directory picks up its parent's inheritable ACLs by itself. That is the same
// promise the Unix half makes by hand, kept by the filesystem instead.
//
// It is a real no-op rather than a call to os.Chown, which exists on Windows
// and always fails: an ignored error every time a folder is created is noise
// that teaches whoever reads the log to ignore the next one too.
func inheritFrom(parent, made string) {}
