//go:build !linux

package appdata

// EnterInitNamespace does nothing outside Linux, which has no mount
// namespaces to leave.
func EnterInitNamespace([]string) {}
