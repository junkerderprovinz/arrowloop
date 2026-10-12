package web

import "testing"

func TestAConnectionStringLosesItsParametersInTheReport(t *testing.T) {
	for in, want := range map[string]string{
		":s3,access_key_id=AK,secret_access_key=SK:bucket/photos": ":s3:bucket/photos",
		`nas,pass="a:b":share`:     "nas:share",
		"cloud:photos":             "cloud:photos",
		"/srv/photos, 2024":        "/srv/photos, 2024",
		`C:\Users\me\Pictures,old`: `C:\Users\me\Pictures,old`,
		"photos,2024/raw":          "photos,2024/raw",
	} {
		if got := withoutParameters(in); got != want {
			t.Errorf("withoutParameters(%q) = %q, want %q", in, got, want)
		}
	}
}

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

func TestAValueIsQuotedOnlyRightAfterItsEqualsSign(t *testing.T) {
	for in, want := range map[string]string{
		`nas,pass=it's:share`:      "nas:share",
		`nas,pass="a""b:c":share`:  "nas:share",
		`nas,pass='never closed:x`: "nas",
	} {
		if got := withoutParameters(in); got != want {
			t.Errorf("withoutParameters(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAHomeFolderBecomesATilde(t *testing.T) {
	for in, want := range map[string]string{
		"/home/bob/Pictures":                   "~/Pictures",
		`C:\Users\Junker der Provinz\Pictures`: `~\Pictures`,
		"/Users/anna":                          "~",
		"nas:/home/bob/x":                      "nas:~/x",
		`open "C:\Users\bob\x": access denied`: `open "~\x": access denied`,
		"/mnt/user/photos":                     "/mnt/user/photos",
		"/storage/emulated/0/DCIM":             "/storage/emulated/0/DCIM",
	} {
		if got := withoutHome(in); got != want {
			t.Errorf("withoutHome(%q) = %q, want %q", in, got, want)
		}
	}
}
