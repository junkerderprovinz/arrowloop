package autostart

import (
	"encoding/xml"
	"slices"
	"testing"
)

func TestTheAgentCarriesAPathWithMarkupInIt(t *testing.T) {
	const exe = "/Users/jane/Apps & <Tools>/ArrowLoop.app/Contents/MacOS/ArrowLoop"
	var agent struct {
		Args []string `xml:"dict>array>string"`
	}
	if err := xml.Unmarshal([]byte(plist(exe)), &agent); err != nil {
		t.Fatalf("launchd could not read the agent: %v", err)
	}
	if want := []string{exe, arg}; !slices.Equal(agent.Args, want) {
		t.Fatalf("the agent starts %q, expected %q", agent.Args, want)
	}
}
