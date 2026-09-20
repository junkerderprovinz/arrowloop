package remotes

import (
	"strings"
	"testing"

	// In the program main fills the registry; without this the test would see
	// only the few backends this package imports.
	_ "github.com/rclone/rclone/backend/all"
)

// A provider whose backend is not compiled in is filtered out of Providers()
// without a word, so a backend name that is spelt wrong takes its provider off
// the list unnoticed.
func TestEveryProviderReachesABackendThatExists(t *testing.T) {
	have := map[string]bool{}
	for _, b := range Backends() {
		have[b.Name] = true
	}
	if len(have) < 20 {
		t.Fatalf("only %d backends compiled in; this test cannot say anything", len(have))
	}

	var lost []string
	for _, p := range providers {
		if !have[p.Backend] {
			lost = append(lost, p.ID+" wants "+p.Backend)
		}
	}
	if len(lost) > 0 {
		t.Errorf("these providers name a backend rclone does not have, so they never appear:\n  %s",
			strings.Join(lost, "\n  "))
	}
}

func TestProvidersAndTheTableAgreeOnHowMany(t *testing.T) {
	if got, want := len(Providers()), len(providers); got != want {
		t.Errorf("the table holds %d providers and the interface offers %d", want, got)
	}
}
