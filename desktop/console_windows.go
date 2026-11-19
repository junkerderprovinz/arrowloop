//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

var procAttachConsole = kernel32.NewProc("AttachConsole")

// attachParentProcess is ATTACH_PARENT_PROCESS, the console of whoever started
// the program.
const attachParentProcess = ^uintptr(0)

// useParentConsole lets a command print in the cmd or PowerShell window it was
// typed in. The program is built for the GUI subsystem, so Windows gives it no
// console of its own. Under Task Scheduler there is no parent console, so
// nothing is printed, and output redirected to a file or a pipe keeps going
// there.
func useParentConsole() {
	stdout, _ := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE)
	stderr, _ := windows.GetStdHandle(windows.STD_ERROR_HANDLE)
	if stdout != 0 && stderr != 0 {
		return
	}
	if ok, _, _ := procAttachConsole.Call(attachParentProcess); ok == 0 {
		return
	}
	console, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0)
	if err != nil {
		return
	}
	if stdout == 0 {
		os.Stdout = console
		_ = windows.SetStdHandle(windows.STD_OUTPUT_HANDLE, windows.Handle(console.Fd()))
	}
	if stderr == 0 {
		os.Stderr = console
		_ = windows.SetStdHandle(windows.STD_ERROR_HANDLE, windows.Handle(console.Fd()))
	}
}
