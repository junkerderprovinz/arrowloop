package main

import (
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/appimage"
)

// pommelPorter is the version of the installer the build ships with, which
// scripts/desktop.mjs sets where there is one.
var pommelPorter string

// startAgain starts this program anew with the arguments it was started with.
// The new process waits for this one to end before it takes the single
// instance lock.
func startAgain() error {
	exe := appimage.Path()
	if exe == "" {
		var err error
		if exe, err = os.Executable(); err != nil {
			return err
		}
	}
	c := exec.Command(exe, againArgs(os.Args[1:], os.Getpid())...)
	c.Env = os.Environ()
	return c.Start()
}

// againArgs keeps the arguments of this start, without the wait of an earlier
// restart, and adds the wait for pid.
func againArgs(args []string, pid int) []string {
	out := make([]string, 0, len(args)+2)
	for i := 0; i < len(args); i++ {
		name := strings.TrimLeft(args[i], "-")
		if name == "after" {
			i++
			continue
		}
		if strings.HasPrefix(name, "after=") {
			continue
		}
		out = append(out, args[i])
	}
	return slices.Concat(out, []string{"--after", strconv.Itoa(pid)})
}
