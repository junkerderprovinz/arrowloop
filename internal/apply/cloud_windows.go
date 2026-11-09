package apply

import (
	"errors"
	"syscall"

	"golang.org/x/sys/windows"
)

// cloudOnly reports whether a file could not be read because it is a cloud
// client's placeholder that the client failed to download, as with OneDrive or
// OpenCloud files kept online only.
func cloudOnly(err error) bool {
	var no syscall.Errno
	if !errors.As(err, &no) {
		return false
	}
	switch no {
	case windows.ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING,
		windows.ERROR_CLOUD_FILE_NOT_IN_SYNC,
		windows.ERROR_CLOUD_FILE_AUTHENTICATION_FAILED,
		windows.ERROR_CLOUD_FILE_NETWORK_UNAVAILABLE,
		windows.ERROR_CLOUD_FILE_UNSUCCESSFUL,
		windows.ERROR_CLOUD_FILE_REQUEST_ABORTED,
		windows.ERROR_CLOUD_FILE_REQUEST_CANCELED,
		windows.ERROR_CLOUD_FILE_PROVIDER_TERMINATED,
		windows.ERROR_CLOUD_FILE_REQUEST_TIMEOUT:
		return true
	}
	return false
}
