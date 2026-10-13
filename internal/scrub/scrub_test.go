package scrub

import (
	"strings"
	"testing"
)

func TestAConnectionStringLosesItsParameters(t *testing.T) {
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
		if got := Home(in); got != want {
			t.Errorf("Home(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAConnectionStringInFreeTextLosesItsParameters(t *testing.T) {
	for in, want := range map[string]string{
		"open nas,user=bob,pass=hunter2:share: refused":            "open nas:share: refused",
		`list :s3,access_key_id=AK,secret_access_key="a:b":bucket`: "list :s3:bucket",
		`the side ":sftp,host=h,pass=\"a:b\":/x" is gone`:          `the side ":sftp:/x" is gone`,
		"gone: :sftp,host=h,key_file_pass=X\nnext line: kept":      "gone: :sftp\nnext line: kept",
		"a :webdav,url=u,bearer_token=T:/a and nas,pass=P:/b":      "a :webdav:/a and nas:/b",
		"3 copied, 0 moved, 0 trashed":                             "3 copied, 0 moved, 0 trashed",
		"could not reach ftp://alice:s3cret@host/path":             "could not reach ftp://alice:***@host/path",
	} {
		if got := Text(in); got != want {
			t.Errorf("Text(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWhatAHookPrintedIsLeftOut(t *testing.T) {
	got := Text("photos: the command before the run failed, so the run did not start: exit status 3: HOOKSECRET")
	if strings.Contains(got, "HOOKSECRET") || !strings.Contains(got, "exit status 3") {
		t.Errorf("Text kept the output or lost the status: %q", got)
	}
}
