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

// What the machine is doing that a schedule should respect.
//
// Both answers can only be had from the operating system, and only on the
// desktop: a container has no battery and no idea what kind of connection the
// host is on. The engine therefore asks a function, and this file is what the
// desktop build hands it. Neither question exists in the container build and
// nothing there is ever held back.
//
// Held back is not failed. A laptop on battery, or a phone hotspot somebody
// pays for by the megabyte, is a machine behaving exactly as instructed, and a
// log full of "failed" for that teaches people to stop reading the log.

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
//
// ACLineStatus is 0 offline, 1 online and 255 unknown. Unknown is treated as ON
// MAINS on purpose, and the direction matters: a desktop PC with no battery
// reports unknown on some hardware, and treating that as "on battery" would
// silently stop every scheduled job on a machine that has no battery to save.
// Being wrong in the other direction costs a laptop some charge once.
func onBattery() (bool, error) {
	var status systemPowerStatus
	ret, _, err := procGetSystemPowerSt.Call(uintptr(unsafe.Pointer(&status)))
	if ret == 0 {
		return false, fmt.Errorf("ask Windows about the power supply: %w", err)
	}
	return status.ACLineStatus == 0, nil
}

// meteredish reports whether Windows says this connection is one to be careful
// with.
//
// INTERNET_CONNECTION_MODEM (0x01) is the flag that survives from the dial-up
// era and is what Windows still sets for a metered mobile connection. It is an
// approximation and it is named as one: the modern answer lives in the WinRT
// NetworkInformation API, which needs a COM apartment and a considerably larger
// amount of machinery than a scheduled sync is worth. What this catches is the
// case somebody actually has, a phone hotspot, and what it misses is a metered
// Ethernet link somebody marked by hand.
func meteredish() (bool, error) {
	var flags uint32
	ret, _, err := procInternetGetConnSt.Call(uintptr(unsafe.Pointer(&flags)), 0)
	if ret == 0 {
		// No connection at all. Not metered, and the run will fail on its own
		// terms in a way that says something more useful than this could.
		return false, nil
	}
	if err != nil && err.(syscall.Errno) != 0 {
		return false, nil
	}
	const connectionModem = 0x01
	return flags&connectionModem != 0, nil
}

// powerCondition builds the check the runner asks before every automatic run.
//
// It reads the settings each time rather than closing over them, because
// somebody switching "not on battery" on expects the next scheduled run to
// respect it, not the next restart.
func powerCondition(window *deskset.Store) daemon.Condition {
	return func(_ context.Context, _ job.Job) error {
		set := window.Get()
		if set.NotOnBattery {
			on, err := onBattery()
			// An unanswerable question lets the run through. A condition that
			// blocks when it cannot tell is a condition that stops everything
			// the day an API returns an error, and nobody would connect the two.
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
