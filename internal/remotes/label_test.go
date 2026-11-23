package remotes

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

func TestATargetIsCalledWhateverSomebodyTypes(t *testing.T) {
	ownConfig(t)
	for _, label := range []string{
		"OneDrive - Business",
		"Fotos für Oma",
		"NAS 📦 Keller",
		"a # b ; c = d",
		`"quoted" and 'single'`,
		"C:",
		"Облако",
	} {
		id, err := Add(label, "local", nil)
		if err != nil {
			t.Errorf("%q was refused: %v", label, err)
			continue
		}
		if err := validName(id); err != nil {
			t.Errorf("%q got the id %q, which rclone cannot take: %v", label, id, err)
		}
		if len(id) < 2 {
			t.Errorf("%q got the id %q, which reads as a drive letter", label, id)
		}
		if got := listed(t, id).Label; got != label {
			t.Errorf("%q is listed as %q", label, got)
		}
	}
}

func TestALabelSurvivesARereadOfTheFile(t *testing.T) {
	ownConfig(t)
	id, err := Add("OneDrive - Business", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	configfile.Install()
	if got := listed(t, id).Label; got != "OneDrive - Business" {
		t.Errorf("read back from the file the label is %q", got)
	}
}

func TestRenamingKeepsTheTargetsID(t *testing.T) {
	ownConfig(t)
	id, err := Add("OneDriveB", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := Rename(id, "OneDrive - Business"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	r := listed(t, id)
	if r.Label != "OneDrive - Business" {
		t.Errorf("after the rename the target is called %q", r.Label)
	}
	if !Reaches(id+":Documents", r.Name) {
		t.Error("a job's side written before the rename no longer reaches the target")
	}
	if len(List()) != 1 {
		t.Errorf("renaming left %d targets", len(List()))
	}
}

func TestAnEditKeepsTheLabel(t *testing.T) {
	ownConfig(t)
	id, err := Add("Work files", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := Save(id, "local", map[string]string{"links": "true"}); err != nil {
		t.Fatal(err)
	}
	if got := listed(t, id).Label; got != "Work files" {
		t.Errorf("an edit of the settings changed the label to %q", got)
	}
}

func TestTheLabelIsNoSettingOfTheForm(t *testing.T) {
	ownConfig(t)
	id, err := Add("Work files", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range listed(t, id).Settings {
		if s.Key == LabelKey {
			t.Error("the label is listed among rclone's settings, where the form would show it twice")
		}
	}
}

func TestALabelThatSaysNothingIsRefused(t *testing.T) {
	ownConfig(t)
	id, err := Add("Work files", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, label := range []string{"", "   ", strings.Repeat("x", MaxLabel+1), "two\nlines", "tab\there"} {
		if _, err := Add(label, "local", nil); err == nil {
			t.Errorf("a new target called %q was taken", label)
		}
		if err := Rename(id, label); err == nil {
			t.Errorf("a rename to %q was taken", label)
		}
	}
	if got := listed(t, id).Label; got != "Work files" {
		t.Errorf("a refused rename left the label %q", got)
	}
	if _, err := Add(strings.Repeat("ü", MaxLabel), "local", nil); err != nil {
		t.Errorf("a label of %d characters was refused for its bytes: %v", MaxLabel, err)
	}
}

func TestTwoTargetsCannotGoByOneName(t *testing.T) {
	ownConfig(t)
	first, err := Add("Backup", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Add("Archive", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Add("Backup", "local", nil); !errors.Is(err, ErrLabelTaken) {
		t.Errorf("a second target called Backup answered %v", err)
	}
	if err := Rename(second, " Backup "); !errors.Is(err, ErrLabelTaken) {
		t.Errorf("renaming a target to another's name answered %v", err)
	}
	if err := Rename(first, "Backup"); err != nil {
		t.Errorf("renaming a target to its own name was refused: %v", err)
	}
}

func TestANewIDStaysClearOfTheOnesInUse(t *testing.T) {
	ownConfig(t)
	if err := Save("Backup-2", "local", nil); err != nil {
		t.Fatal(err)
	}
	first, err := Add("Backup", "local", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := Rename(first, "Old backup"); err != nil {
		t.Fatal(err)
	}
	second, err := Add("Backup", "local", nil)
	if err != nil {
		t.Fatalf("the name Backup is free again and was refused: %v", err)
	}
	if second == first || second == "Backup-2" {
		t.Errorf("the second target was given the id %q, which is in use", second)
	}
}

// Targets set up before they had labels are found under the names they have,
// which every job, every wrapping target and rclone's command line write.
func TestATargetFromBeforeLabelsGoesByItsName(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rclone.conf")
	old := "[OneDriveB]\ntype = local\n\n[vault]\ntype = crypt\nremote = OneDriveB:secret\npassword = x\n"
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := config.SetConfigPath(path); err != nil {
		t.Fatal(err)
	}
	configfile.Install()

	if got := listed(t, "OneDriveB").Label; got != "OneDriveB" {
		t.Errorf("an old target is called %q", got)
	}
	if !Reaches("vault:photos", "OneDriveB") {
		t.Error("the crypt target lost the target it wraps")
	}
	if raw, _ := os.ReadFile(path); string(raw) != old {
		t.Errorf("reading the targets rewrote the file:\n%s", raw)
	}

	if err := Rename("OneDriveB", "OneDrive - Business"); err != nil {
		t.Fatal(err)
	}
	if !Reaches("vault:photos", "OneDriveB") {
		t.Error("after the rename the crypt target lost the target it wraps")
	}
	if err := Rename("OneDriveB", "OneDriveB"); err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(path); strings.Contains(string(raw), LabelKey) {
		t.Errorf("a label that says what the id says was kept:\n%s", raw)
	}
}
