//go:build !windows

package main

// useParentConsole matters only on Windows, where the program has no console
// of its own. Elsewhere a command prints in the terminal it was started from.
func useParentConsole() {}
