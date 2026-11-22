package vpn

import "golang.org/x/sys/unix"

// routeSocketAllowed opens the netlink socket wireguard-go follows routes
// with, the same way it does.
func routeSocketAllowed() bool {
	fd, err := unix.Socket(unix.AF_NETLINK, unix.SOCK_RAW|unix.SOCK_CLOEXEC, unix.NETLINK_ROUTE)
	if err != nil {
		return false
	}
	defer unix.Close(fd)
	return unix.Bind(fd, &unix.SockaddrNetlink{Family: unix.AF_NETLINK, Groups: unix.RTMGRP_IPV4_ROUTE}) == nil
}
