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

	"golang.org/x/sys/unix"
)

// networkProcessName is WebKitNetworkProcess as the kernel keeps it, cut to
// 15 bytes.
const networkProcessName = "WebKitNetworkPr"

// releaseWebview hands back what WebKitGTK keeps once its last window has
// gone. Its network process stays for the life of the program, and WebKit
// starts a fresh one with the next window. The freed memory of the windows
// stays with glibc until it is trimmed. The code of WebKit, the GL driver and
// the program itself stays resident too, though the tray copy runs little of
// it, so it is paged out the way the kernel would under pressure.
func releaseWebview() {
	for _, pid := range networkProcesses(os.DirFS("/proc"), os.Getpid()) {
		if err := syscall.Kill(pid, syscall.SIGTERM); err != nil {
			log.Printf("could not stop WebKit's network process: %v", err)
		}
	}
	C.malloc_trim(0)
	if maps, err := os.ReadFile("/proc/self/maps"); err == nil {
		for _, s := range fileSpans(string(maps)) {
			// A kernel older than 5.4 does not know the advice and leaves the
			// pages resident.
			_, _, _ = unix.Syscall(unix.SYS_MADVISE, s.start, s.end-s.start, unix.MADV_PAGEOUT)
		}
	}
}

// span is a range of addresses.
type span struct{ start, end uintptr }

// fileSpans returns the mappings in a /proc/<pid>/maps listing that hold
// files nobody writes through, the pages of which can be read in again.
func fileSpans(maps string) []span {
	var spans []span
	for line := range strings.Lines(maps) {
		f := strings.Fields(line)
		if len(f) < 6 || f[1][1] == 'w' || f[4] == "0" {
			continue
		}
		path := strings.Join(f[5:], " ")
		if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "/memfd:") || strings.HasSuffix(path, "(deleted)") {
			continue
		}
		start, end, _ := strings.Cut(f[0], "-")
		from, err1 := strconv.ParseUint(start, 16, 64)
		to, err2 := strconv.ParseUint(end, 16, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		spans = append(spans, span{uintptr(from), uintptr(to)})
	}
	return spans
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
