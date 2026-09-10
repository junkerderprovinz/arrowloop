package remotes

import (
	"strings"
	"testing"

	// The registry is empty unless something fills it, and in the running
	// program that something is main. Without this import the test sees four
	// backends and cannot say anything about the other sixty-four - which is
	// worse than not testing, because it looks like a pass.
	_ "github.com/rclone/rclone/backend/all"
)

// TestEveryProviderReachesABackendThatExists.
//
// A provider whose `Backend` does not match a compiled-in rclone type is
// filtered out of Providers() and vanishes from the screen without a word.
// Nothing fails, nothing is logged, and the row simply is not there - which is
// indistinguishable from never having written it down.
//
// Two did exactly that: rclone registers its Google backends as "google cloud
// storage" and "google photos", WITH SPACES, and this table said
// "googlecloudstorage" and "googlephotos". Both providers had a name, a mark
// and an entry, and neither ever appeared. Found by counting the rendered list
// against the table rather than by reading either of them.
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

// TestProvidersAndTheTableAgreeOnHowMany.
//
// The other half of the same guard, from the other end: whatever the table
// holds is what the interface offers. If those two numbers drift apart, some
// entry is being dropped and the test above says which.
func TestProvidersAndTheTableAgreeOnHowMany(t *testing.T) {
	if got, want := len(Providers()), len(providers); got != want {
		t.Errorf("the table holds %d providers and the interface offers %d", want, got)
	}
}
