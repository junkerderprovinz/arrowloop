package remotes

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	_ "github.com/rclone/rclone/backend/alias"
	_ "github.com/rclone/rclone/backend/archive"
	_ "github.com/rclone/rclone/backend/compress"
	_ "github.com/rclone/rclone/backend/crypt"
)

// aliasTo sets up a target called box that is a plain folder on this machine,
// which is the one backend a test can list without a network.
func aliasTo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	configured(t, "box", "alias", map[string]string{"remote": root})
	return root
}

func TestATargetsFoldersAreListedWithoutItsFiles(t *testing.T) {
	root := aliasTo(t)
	for _, dir := range []string{"Photos", "archive", "Photos/2024"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	top, err := Folders(context.Background(), "box", "")
	if err != nil {
		t.Fatalf("list the top of the target: %v", err)
	}
	if want := []string{"archive", "Photos"}; !reflect.DeepEqual(top, want) {
		t.Errorf("the top of the target lists %v, want %v", top, want)
	}

	inner, err := Folders(context.Background(), "box", "Photos")
	if err != nil {
		t.Fatalf("list a folder on the target: %v", err)
	}
	if want := []string{"2024"}; !reflect.DeepEqual(inner, want) {
		t.Errorf("Photos lists %v, want %v", inner, want)
	}
}

func TestAnEmptyFolderOnATargetListsAsNothingRatherThanNull(t *testing.T) {
	aliasTo(t)
	got, err := Folders(context.Background(), "box", "")
	if err != nil {
		t.Fatalf("list an empty target: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("an empty target lists %#v", got)
	}
}

func TestAWrapperOverAFolderNotYetMadeListsAsEmpty(t *testing.T) {
	for backend, settings := range map[string]map[string]string{
		"crypt":    {"password": "correct horse"},
		"compress": {},
		"archive":  {},
	} {
		t.Run(backend, func(t *testing.T) {
			root := aliasTo(t)
			settings["remote"] = "box:" + backend
			if err := Save("wrapped", backend, settings); err != nil {
				t.Fatalf("save the %s target: %v", backend, err)
			}

			got, err := Folders(context.Background(), "wrapped", "")
			if err != nil {
				t.Fatalf("list the top of a fresh %s target: %v", backend, err)
			}
			if len(got) != 0 {
				t.Errorf("a fresh %s target lists %v", backend, got)
			}
			if _, err := os.Stat(filepath.Join(root, backend)); !os.IsNotExist(err) {
				t.Errorf("listing made the wrapped folder: %v", err)
			}
		})
	}
}

func TestAMissingFolderInsideATargetIsAnError(t *testing.T) {
	aliasTo(t)
	if _, err := Folders(context.Background(), "box", "gone"); err == nil {
		t.Error("a folder that is not there listed without an error")
	}
}

func TestAFolderMadeOnATargetExistsThere(t *testing.T) {
	root := aliasTo(t)
	if err := os.Mkdir(filepath.Join(root, "Photos"), 0o755); err != nil {
		t.Fatal(err)
	}

	made, err := MakeFolder(context.Background(), "box", "Photos", "Holiday")
	if err != nil {
		t.Fatalf("make a folder on the target: %v", err)
	}
	if made != "box:Photos/Holiday" {
		t.Errorf("the new folder is reported as %q", made)
	}
	if info, err := os.Stat(filepath.Join(root, "Photos", "Holiday")); err != nil || !info.IsDir() {
		t.Errorf("no folder arrived on the target: %v", err)
	}
}

func TestOnlyAConfiguredTargetCountsAsOne(t *testing.T) {
	aliasTo(t)
	cases := []struct {
		in        string
		name, dir string
		ok        bool
	}{
		{"box:", "box", "", true},
		{"box:Photos/2024/", "box", "Photos/2024", true},
		{"box:/", "box", "/", true},
		{"elsewhere:Photos", "", "", false},
		{"/srv/photos", "", "", false},
		{"", "", "", false},
	}
	for _, c := range cases {
		name, dir, ok := Split(c.in)
		if name != c.name || dir != c.dir || ok != c.ok {
			t.Errorf("Split(%q) = %q, %q, %v; want %q, %q, %v", c.in, name, dir, ok, c.name, c.dir, c.ok)
		}
	}
}

func TestADriveLetterIsNeverATarget(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive letters only exist on Windows")
	}
	configured(t, "C", "alias", map[string]string{"remote": t.TempDir()})
	if _, _, ok := Split(`C:\Users`); ok {
		t.Error("a Windows path was taken for a target named C")
	}
}

// An SFTP or FTP target opens at the login's home, which is not the server's
// root, so the root has to be one step up from it or it can only be typed.
func TestGoingUpFromALoginsHomeReachesTheServersRoot(t *testing.T) {
	for _, backend := range []string{"sftp", "ftp"} {
		t.Run(backend, func(t *testing.T) {
			configured(t, "nas", backend, map[string]string{"host": "nas.example"})
			cases := map[string]string{
				"":       "nas:/",
				"Photos": "nas:",
				"/":      "",
				"/srv":   "nas:/",
			}
			for dir, want := range cases {
				if got := Parent("nas", dir); got != want {
					t.Errorf("Parent(nas, %q) = %q, want %q", dir, got, want)
				}
			}
		})
	}
}

func TestGoingUpATargetEndsAtTheRoots(t *testing.T) {
	cases := map[string]string{
		"Photos/2024": "box:Photos",
		"Photos":      "box:",
		"":            "",
		"/":           "",
		"/srv":        "box:/",
	}
	for dir, want := range cases {
		if got := Parent("box", dir); got != want {
			t.Errorf("Parent(box, %q) = %q, want %q", dir, got, want)
		}
	}
}
