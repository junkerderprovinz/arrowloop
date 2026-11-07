//go:build !windows && !darwin && !linux

package accent

// Read has no source to ask on this system.
func Read() string { return "" }
