//go:build windows

package web

import (
	"errors"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	mpr                  = windows.NewLazySystemDLL("mpr.dll")
	procWNetOpenEnum     = mpr.NewProc("WNetOpenEnumW")
	procWNetEnumResource = mpr.NewProc("WNetEnumResourceW")
	procWNetCloseEnum    = mpr.NewProc("WNetCloseEnum")
	procWNetGetUser      = mpr.NewProc("WNetGetUserW")
)

const (
	resourceConnected = 1
	resourceTypeDisk  = 1
)

// netResource is NETRESOURCEW.
type netResource struct {
	Scope       uint32
	Type        uint32
	DisplayType uint32
	Usage       uint32
	LocalName   *uint16
	RemoteName  *uint16
	Comment     *uint16
	Provider    *uint16
}

// connectedShares asks the Windows network provider for every disk share this
// session is connected to, mapped to a letter or not.
func connectedShares() ([]share, error) {
	var h windows.Handle
	if r, _, _ := procWNetOpenEnum.Call(resourceConnected, resourceTypeDisk, 0, 0, uintptr(unsafe.Pointer(&h))); r != 0 {
		// No network provider at all is a machine with no shares.
		if syscall.Errno(r) == windows.ERROR_NO_NETWORK {
			return nil, nil
		}
		return nil, syscall.Errno(r)
	}
	defer procWNetCloseEnum.Call(uintptr(h))

	// uint64 rather than bytes, because the entries hold pointers and need
	// their alignment. The strings they point at sit in the same buffer.
	buf := make([]uint64, 2048)
	var out []share
	for {
		count := ^uint32(0)
		size := uint32(len(buf) * 8)
		r, _, _ := procWNetEnumResource.Call(uintptr(h), uintptr(unsafe.Pointer(&count)),
			uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
		switch err := syscall.Errno(r); {
		case r == 0:
		case errors.Is(err, windows.ERROR_NO_MORE_ITEMS):
			return out, nil
		case errors.Is(err, windows.ERROR_MORE_DATA):
			buf = make([]uint64, size/8+1)
			continue
		default:
			return out, err
		}
		for _, item := range unsafe.Slice((*netResource)(unsafe.Pointer(&buf[0])), count) {
			local := windows.UTF16PtrToString(item.LocalName)
			remote := windows.UTF16PtrToString(item.RemoteName)
			// Windows answers for a mapped drive by its letter and for any
			// other connection by its address.
			asked := local
			if asked == "" {
				asked = remote
			}
			found, ok := shareFrom(local, remote, accountFor(asked))
			if ok {
				out = append(out, found)
			}
		}
	}
}

// accountFor is the user name a connection was made with, or empty when
// Windows does not say.
func accountFor(connection string) string {
	name, err := windows.UTF16PtrFromString(connection)
	if err != nil {
		return ""
	}
	buf := make([]uint16, 256)
	size := uint32(len(buf))
	if r, _, _ := procWNetGetUser.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size))); r != 0 {
		return ""
	}
	return windows.UTF16ToString(buf)
}
