//go:build !linux

package main

// releaseWebKit has nothing to do where the webview is not WebKitGTK.
func releaseWebKit() {}
