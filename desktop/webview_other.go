//go:build !linux && !windows

package main

// releaseWebview leaves macOS to look after the memory of its own webview.
func releaseWebview() {}
