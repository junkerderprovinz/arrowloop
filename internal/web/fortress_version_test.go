package web_test

import "testing"

// The other apps print a member's version after a "v" of their own, so a tag
// handed on as it is would read "vv2.7.0" there.
func TestTheFortressSeesTheVersionWithoutTheTagsV(t *testing.T) {
	runningVersion(t, "v2.7.0")
	url := testRelay(t)
	a := nodeWith(t, setup{relay: url}, newHarness(t))
	b := nodeWith(t, setup{relay: url}, newHarness(t))
	words := newWords(t)
	a.join(t, words)
	b.join(t, words)
	var got string
	eventually(t, "the first to see the second", func() bool {
		var v struct {
			Members []struct {
				App     string `json:"app"`
				Version string `json:"version"`
			} `json:"members"`
		}
		a.get(t, "/api/fortress", &v)
		for _, m := range v.Members {
			if m.App == "arrowloop" {
				got = m.Version
				return true
			}
		}
		return false
	})
	if got != "2.7.0" {
		t.Errorf("version = %q, want 2.7.0", got)
	}
}
