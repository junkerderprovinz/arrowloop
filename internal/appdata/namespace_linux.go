package appdata

import (
	"log"
	"os"
	"os/exec"
	"syscall"
)

// EnterInitNamespace starts the server again in init's mount namespace when it
// runs in an app's, and returns only when it stays where it is.
func EnterInitNamespace(args []string) {
	// In an app's namespace /data/data holds little more than the app's own
	// folder, and su keeps the namespace of the app that called it. A process
	// with more than one thread cannot change its mount namespace, and the Go
	// runtime always has several, hence the exec.
	self, _ := os.Readlink("/proc/self/ns/mnt")
	initNS, _ := os.Readlink("/proc/1/ns/mnt")
	nsenter, _ := exec.LookPath("nsenter")
	exe, _ := os.Executable()
	argv := intoInit(self, initNS, nsenter, exe, args)
	if argv == nil {
		return
	}
	// A root manager can refuse the switch, and then the server serves what
	// it sees rather than nothing.
	if err := exec.Command(nsenter, "-t", "1", "-m", "--", "true").Run(); err != nil {
		log.Printf("staying in this mount namespace, nsenter failed: %v", err)
		return
	}
	err := syscall.Exec(nsenter, argv, os.Environ())
	log.Printf("staying in this mount namespace: %v", err)
}
