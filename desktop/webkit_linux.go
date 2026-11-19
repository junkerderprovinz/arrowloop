package main

/*
#include <malloc.h>
*/
import "C"

import (
	"bytes"
	"io/fs"
	"log"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// networkProcessName is WebKitNetworkProcess as the kernel keeps it, cut to
// 15 bytes.
const networkProcessName = "WebKitNetworkPr"

// releaseWebKit hands back what WebKitGTK keeps once its last window has
// gone. Its network process stays for the life of the program, and WebKit
// starts a fresh one with the next window. The freed memory of the windows
// stays with glibc until it is trimmed.
func releaseWebKit() {
	for _, pid := range networkProcesses(os.DirFS("/proc"), os.Getpid()) {
		if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
			log.Printf("could not stop WebKit's network process: %v", err)
		}
	}
	C.malloc_trim(0)
}

// networkProcesses returns the WebKit network processes that parent started,
// read from a /proc file system.
func networkProcesses(proc fs.FS, parent int) []int {
	entries, err := fs.ReadDir(proc, ".")
	if err != nil {
		return nil
	}
	var pids []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		stat, err := fs.ReadFile(proc, e.Name()+"/stat")
		if err != nil {
			continue
		}
		// The name may hold spaces and parentheses itself, so the fields
		// after it start at the last closing one.
		open, end := bytes.IndexByte(stat, '('), bytes.LastIndexByte(stat, ')')
		if open < 0 || end < open {
			continue
		}
		fields := strings.Fields(string(stat[end+1:]))
		if string(stat[open+1:end]) == networkProcessName && len(fields) > 1 && fields[1] == strconv.Itoa(parent) {
			pids = append(pids, pid)
		}
	}
	return pids
}
