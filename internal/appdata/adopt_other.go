//go:build !linux

package appdata

const noFollow = 0

// handOver has nothing to do where there are no app folders to adopt into.
func (h *handler) handOver(p, app string, dir bool) error { return nil }
