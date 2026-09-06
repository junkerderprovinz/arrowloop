//go:build !windows && !linux && !darwin

package autostart

import "errors"

// Anything else compiles and answers honestly rather than failing to build.
// The interface asks Supported first and leaves the switch out, so nobody is
// offered a setting this system cannot keep.
const supported = false

var errUnsupported = errors.New("autostart is not supported on this system")

func enabled() (bool, error)        { return false, nil }
func enable(string) error           { return errUnsupported }
func disable() error                { return errUnsupported }
func pointsAt(string) (bool, error) { return false, nil }
