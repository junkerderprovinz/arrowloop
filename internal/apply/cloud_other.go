//go:build !windows

package apply

// cloudOnly reports whether a file is a cloud placeholder that could not be
// downloaded, which only Windows tells apart.
func cloudOnly(error) bool { return false }
