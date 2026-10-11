//go:build windows

package scenario

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A junction reads as a link only with winsymlink=0 in go.mod. Without it Go
// reports every reparse point as irregular, and rclone then also drops the
// folders of a cloud client that fetches files on demand.
func TestAJunctionIsReportedAsALinkAndNotFollowed(t *testing.T) {
	j := newJob(t, quick())
	write(t, j.left, "real/inside.txt", "the real file")
	link := filepath.Join(j.left, "shortcut")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, filepath.Join(j.left, "real")).CombinedOutput(); err != nil {
		t.Fatalf("make a junction: %v: %s", err, out)
	}

	p, _ := j.sync(t)
	var reported bool
	for _, s := range p.Skipped {
		if s.Path == "shortcut" && strings.Contains(s.Reason.Text, "symbolic link") {
			reported = true
		}
	}
	if !reported {
		t.Fatalf("the junction was not reported as a link: %+v", p.Skipped)
	}
	if _, err := os.Lstat(filepath.Join(j.right, "shortcut")); !os.IsNotExist(err) {
		t.Error("the junction was carried across")
	}
	if _, err := os.Stat(filepath.Join(j.right, "real", "inside.txt")); err != nil {
		t.Errorf("the real folder did not arrive: %v", err)
	}
}
