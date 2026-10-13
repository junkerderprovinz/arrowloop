package web

import "testing"

func TestReleasesCompareByNumberNotByText(t *testing.T) {
	a, _ := releaseVersion("v1.10.0")
	b, _ := releaseVersion("1.9.3")
	if compareVersions(a, b) <= 0 {
		t.Error("1.10.0 should be newer than 1.9.3")
	}
	for _, s := range []string{"dev", "v1.8", "v1.8.0-rc1", "v1.8.0+abc"} {
		if _, ok := releaseVersion(s); ok {
			t.Errorf("%q read as a release", s)
		}
	}
}
