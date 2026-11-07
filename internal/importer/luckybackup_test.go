package importer_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/importer"
)

func TestLuckyBackupTasksBecomeJobs(t *testing.T) {
	p := read(t, "luckybackup.profile")
	if p.Source != importer.LuckyBackup {
		t.Fatalf("read as %q", p.Source)
	}

	docs := job(t, p, "Documents")
	expect(t, docs, "left", "/home/reeve/Documents")
	expect(t, docs, "right", "/mnt/backup/documents")
	expect(t, docs, "direction", "leftToRight")
	expect(t, docs, "mode", "mirror")
	expect(t, docs, "keepVersions", 2)
	expect(t, docs, "exclude", []string{
		"**/*tmp*/**", "**/*Trash*/**", "**/*trash*/**",
		"*.iso", "build/**", "**/node_modules/**",
	})

	// "Backup source directory by name" makes the folder itself on the far
	// side.
	photos := job(t, p, "Photos to NAS")
	expect(t, photos, "left", "/home/reeve/Pictures")
	expect(t, photos, "right", "nas.example.lan:/srv/backup/Pictures")
	expect(t, photos, "mode", "sync")

	laptop := job(t, p, "Laptop-USB sync")
	expect(t, laptop, "left", "/home/reeve/Sync")
	expect(t, laptop, "right", "/media/reeve/usb/Sync")
	expect(t, laptop, "direction", "both")

	if len(p.Jobs) != 3 {
		t.Errorf("want three jobs, got %v", names(p))
	}
}

func TestLuckyBackupSSHBecomesAnSFTPTarget(t *testing.T) {
	p := read(t, "luckybackup.profile")
	nas := target(t, p, "nas.example.lan")
	if nas.Type != "sftp" || nas.Settings["host"] != "nas.example.lan" || nas.Settings["user"] != "reeve" ||
		nas.Settings["key_file"] != "/home/reeve/.ssh/id_ed25519" {
		t.Errorf("the SSH destination became %+v", nas)
	}
	if _, set := nas.Settings["port"]; set {
		t.Errorf("the standard port was written out: %+v", nas.Settings)
	}
	if len(p.Targets) != 1 {
		t.Errorf("want one target, got %+v", p.Targets)
	}
}

func TestLuckyBackupListsWhatItLeavesOut(t *testing.T) {
	p := read(t, "luckybackup.profile")
	for _, n := range []importer.Note{
		{Subject: "Documents", What: "ExecuteBeforeListItem: mount /mnt/backup"},
		{Subject: "Photos to NAS", What: "OptionsListItem: --bwlimit=2000"},
		{Subject: "Module copy", What: "RemoteModule"},
		{Subject: "Home backups", What: "emailError"},
	} {
		if !has(p.Skipped, n.Subject, n.What) {
			t.Errorf("%+v is not listed in %+v", n, p.Skipped)
		}
	}
}

func TestAnOldBinaryProfileIsExplained(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "luckybackup-binary.profile"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := importer.Read(data); !errors.Is(err, importer.ErrOldProfile) {
		t.Errorf("the binary profile gave %v", err)
	}
}
