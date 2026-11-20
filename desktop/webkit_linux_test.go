package main

import (
	"slices"
	"testing"
	"testing/fstest"
)

func TestNetworkProcessesAreTheOnesThisProgramStarted(t *testing.T) {
	proc := fstest.MapFS{
		"42/stat":   {Data: []byte("42 (ArrowLoop) S 1 42 42 0 -1 4194560")},
		"51/stat":   {Data: []byte("51 (WebKitNetworkPr) S 42 42 42 0 -1 4194560")},
		"52/stat":   {Data: []byte("52 (WebKitWebProces) S 42 42 42 0 -1 4194560")},
		"77/stat":   {Data: []byte("77 (WebKitNetworkPr) S 900 900 900 0 -1 4194560")},
		"80/stat":   {Data: []byte("80 (a) b) (c) S 42 42 42 0 -1 4194560")},
		"self/stat": {Data: []byte("42 (ArrowLoop) S 1 42 42 0 -1 4194560")},
		"meminfo":   {Data: []byte("MemTotal: 1 kB")},
	}
	if got := networkProcesses(proc, 42); !slices.Equal(got, []int{51}) {
		t.Errorf("found %v, expected [51]", got)
	}
}

func TestOnlyCodeAndReadOnlyFilesArePagedOut(t *testing.T) {
	maps := `00400000-04800000 r-xp 00000000 08:01 1234   /opt/ArrowLoop/ArrowLoop
04800000-06000000 r--p 04400000 08:01 1234   /opt/ArrowLoop/ArrowLoop
06000000-06200000 rw-p 05c00000 08:01 1234   /opt/ArrowLoop/ArrowLoop
06200000-06400000 rw-p 00000000 00:00 0
0e000000-0e100000 rw-p 00000000 00:00 0      [heap]
c000000000-c004000000 rw-p 00000000 00:00 0
7f0000000000-7f0004000000 r-xp 00000000 08:01 99     /usr/lib/x86_64-linux-gnu/libLLVM.so.21.1
7f0004000000-7f0004001000 r--p 00000000 00:01 7      /memfd:glycin-frame (deleted)
7f0005000000-7f0005800000 rw-s 00000000 00:01 8      /SYSV00000000 (deleted)
7f0006000000-7f0006100000 r--p 00000000 08:01 120    /usr/lib/locale/C.utf8/LC_CTYPE
7ffd00000000-7ffd00021000 rw-p 00000000 00:00 0      [stack]
ffffffffff600000-ffffffffff601000 --xp 00000000 00:00 0  [vsyscall]
`
	want := []span{
		{0x00400000, 0x04800000},
		{0x04800000, 0x06000000},
		{0x7f0000000000, 0x7f0004000000},
		{0x7f0006000000, 0x7f0006100000},
	}
	if got := fileSpans(maps); !slices.Equal(got, want) {
		t.Errorf("pages out %x, expected %x", got, want)
	}
}
