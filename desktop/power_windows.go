//go:build windows

package main

import (
	"context"
	"fmt"
	"syscall"
	"unsafe"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/job"
)

var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	procGetSystemPowerSt  = kernel32.NewProc("GetSystemPowerStatus")
	wininet               = syscall.NewLazyDLL("wininet.dll")
	procInternetGetConnSt = wininet.NewProc("InternetGetConnectedState")
)

// systemPowerStatus mirrors the Win32 SYSTEM_POWER_STATUS structure.
type systemPowerStatus struct {
	ACLineStatus        byte
	BatteryFlag         byte
	BatteryLifePercent  byte
	SystemStatusFlag    byte
	BatteryLifeTime     uint32
	BatteryFullLifeTime uint32
}

// onBattery reports whether the machine is running from its battery.
// ACLineStatus 255 (unknown) counts as mains, because some desktop PCs without a
// battery report it and would otherwise never run a scheduled job.
func onBattery() (bool, error) {
	var status systemPowerStatus
	ret, _, err := procGetSystemPowerSt.Call(uintptr(unsafe.Pointer(&status)))
	if ret == 0 {
		return false, fmt.Errorf("ask Windows about the power supply: %w", err)
	}
	return status.ACLineStatus == 0, nil
}

// meteredish approximates whether the connection is metered from
// INTERNET_CONNECTION_MODEM, which Windows still sets for a mobile connection
// such as a phone hotspot. It misses an Ethernet link marked metered by hand;
// the exact answer needs WinRT's NetworkInformation and a COM apartment.
func meteredish() (bool, error) {
	var flags uint32
	ret, _, err := procInternetGetConnSt.Call(uintptr(unsafe.Pointer(&flags)), 0)
	if ret == 0 {
		// No connection at all; the run will fail with a better reason.
		return false, nil
	}
	if err != nil && err.(syscall.Errno) != 0 {
		return false, nil
	}
	const connectionModem = 0x01
	return flags&connectionModem != 0, nil
}

// powerCondition builds the check the runner asks before every automatic run.
// It reads the settings on each call so a change applies to the next run. A
// held-back run is not a failure.
func powerCondition(window *deskset.Store) daemon.Condition {
	return func(_ context.Context, _ job.Job) error {
		set := window.Get()
		if set.NotOnBattery {
			on, err := onBattery()
			// A question the system cannot answer lets the run through.
			if err == nil && on {
				return fmt.Errorf("this machine is on battery")
			}
		}
		if set.NotOnMetered {
			metered, err := meteredish()
			if err == nil && metered {
				return fmt.Errorf("this connection is metered")
			}
		}
		return nil
	}
}
