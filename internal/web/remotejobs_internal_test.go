package web

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestASideFromTheGroupStaysWithinWhatTheOwnerUses(t *testing.T) {
	dir := t.TempDir()
	photos := filepath.Join(dir, "photos")
	config := filepath.Join(dir, "config")
	reach := groupReach{
		targets: map[string]bool{"vault": true},
		drives:  map[string]bool{"d1": true},
		roots:   []string{photos},
		private: []string{config},
	}

	for _, side := range []string{
		photos,
		filepath.Join(photos, "2024"),
		photos + string(filepath.Separator) + "a" + string(filepath.Separator) + ".." + string(filepath.Separator) + "b",
		"vault:",
		"vault:music/2024",
		"volume:d1/",
		"volume:d1/holiday/2024",
	} {
		if err := reach.side(side); err != nil {
			t.Errorf("the side %q from the group was refused: %v", side, err)
		}
	}

	for side, code := range map[string]string{
		dir:                                  sideOutside,
		filepath.Join(photos, "..", "other"): sideOutside,
		"photos":                             sideOutside,
		`\\attacker\share\x`:                 sideShare,
		"//attacker/share/x":                 sideShare,
		`\\?\C:\Windows`:                     sideShare,
		"nosuch:folder":                      sideOutside,
		":local:" + filepath.ToSlash(photos): sideOutside,
		"vault,copy_links=true:folder":       sideOutside,
		"vault:../elsewhere":                 sideOutside,
		"vault:music/../../elsewhere":        sideOutside,
		"volume:d1/../../Windows":            sideOutside,
		`volume:d1/..\..\Windows`:            sideOutside,
		"volume:d2/photos":                   sideOutside,
		config:                               sideOutside,
	} {
		var refused *refusedSide
		if err := reach.side(side); !errors.As(err, &refused) || refused.code != code {
			t.Errorf("the side %q from the group = %v, want it refused as %s", side, err, code)
		}
	}
}

func TestTheOwnersOwnFoldersStayOutOfReachUnderAnAllowedSide(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	reach := groupReach{roots: []string{dir}, private: []string{config}}
	for _, side := range []string{config, filepath.Join(config, "state")} {
		var refused *refusedSide
		if err := reach.side(side); !errors.As(err, &refused) || refused.code != sidePrivate {
			t.Errorf("the side %q from the group = %v, want it refused as one of the owner's own folders", side, err)
		}
	}
}

func TestAFolderUnderAnAllowedSideIsComparedWithoutCaseOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("only Windows folds case in paths")
	}
	dir := t.TempDir()
	reach := groupReach{roots: []string{filepath.Join(dir, "Photos")}}
	if err := reach.side(strings.ToUpper(filepath.Join(dir, "photos", "2024"))); err != nil {
		t.Errorf("a folder under an allowed side, spelled in other case, was refused: %v", err)
	}
	if err := reach.side(strings.ToUpper(filepath.Join(dir, "photosx"))); err == nil {
		t.Error("a folder beside an allowed side was let through")
	}
}

func TestALinkUnderAnAllowedSideCannotLeadOutOfIt(t *testing.T) {
	dir := t.TempDir()
	photos := filepath.Join(dir, "photos")
	outside := filepath.Join(dir, "outside")
	for _, d := range []string{photos, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := link(outside, filepath.Join(photos, "away")); err != nil {
		t.Skipf("this system makes no links here: %v", err)
	}
	reach := groupReach{roots: []string{photos}}
	if err := reach.side(filepath.Join(photos, "away")); err == nil {
		t.Error("a link under an allowed side that leads out of it was let through")
	}
}

// link makes a symlink, or on Windows without the right to one, a junction.
func link(target, at string) error {
	err := os.Symlink(target, at)
	if err != nil && runtime.GOOS == "windows" {
		err = exec.Command("cmd", "/c", "mklink", "/J", at, target).Run()
	}
	return err
}

func TestAJobFromTheGroupNamesEachSideOnce(t *testing.T) {
	dir := t.TempDir()
	stored := map[string]any{"name": "photos", "left": dir, "right": dir + "2", "after": "echo done"}
	entry := map[string]any{"name": "photos", "left": dir, "Left": filepath.Join(dir, "sub"), "right": dir + "2"}
	if _, err := fitForOwner(entry, stored, groupReach{roots: []string{dir}}); err == nil {
		t.Error("a job that names its left side twice was taken")
	}
}
