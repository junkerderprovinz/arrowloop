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
