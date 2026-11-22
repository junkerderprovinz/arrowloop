//go:build !linux

package vpn

// routeSocketAllowed is true where wireguard-go follows no routes at all.
func routeSocketAllowed() bool { return true }
