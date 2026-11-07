package importer_test

import (
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/importer"
)

func TestFolderSyncAccountsBecomeTargets(t *testing.T) {
	p := read(t, "foldersync-v1.json")
	if p.Source != importer.FolderSync {
		t.Fatalf("read as %q", p.Source)
	}

	nas := target(t, p, "Home-NAS")
	if nas.Type != "sftp" || nas.Settings["host"] != "nas.example.lan" || nas.Settings["port"] != "2222" || nas.Settings["user"] != "reeve" {
		t.Errorf("the SFTP account became %+v", nas)
	}
	if box := target(t, p, "Dropbox"); box.Type != "dropbox" {
		t.Errorf("the Dropbox account became %+v", box)
	}
	office := target(t, p, "Office")
	if office.Type != "smb" || office.Settings["host"] != "fileserver" || office.Settings["user"] != "reeve" || office.Settings["domain"] != "WORK" {
		t.Errorf("the SMB account became %+v", office)
	}
	if len(p.Targets) != 3 {
		t.Errorf("want three targets, got %+v", p.Targets)
	}

	for _, n := range []importer.Note{
		{Subject: "Home-NAS", What: importer.Password},
		{Subject: "Dropbox", What: importer.SignIn},
		{Subject: "Office", What: importer.Password},
	} {
		if !has(p.FillIn, n.Subject, n.What) {
			t.Errorf("nothing asks for %+v in %+v", n, p.FillIn)
		}
	}
}

func TestFolderSyncPairsBecomeJobs(t *testing.T) {
	p := read(t, "foldersync-v1.json")

	camera := job(t, p, "Camera")
	expect(t, camera, "left", "/storage/emulated/0/DCIM/Camera")
	expect(t, camera, "right", "Home-NAS:/srv/photos/phone")
	expect(t, camera, "direction", "leftToRight")
	expect(t, camera, "mode", "sync")
	expect(t, camera, "schedule", "@daily")
	expect(t, camera, "watch", true)
	expect(t, camera, "exclude", []string{"*.tmp"})

	// The readable path, since the other one is a content:// address and a
	// Dropbox id.
	docs := job(t, p, "Documents")
	expect(t, docs, "left", "/storage/emulated/0/Documents")
	expect(t, docs, "right", "Dropbox:Documents")
	expect(t, docs, "direction", "both")
	expect(t, docs, "schedule", "@every 15m")
	expect(t, docs, "newerWins", true)

	scans := job(t, p, "Scans")
	expect(t, scans, "right", "Office:team/scans")
	expect(t, scans, "direction", "rightToLeft")
	expect(t, scans, "mode", "move")
	if _, set := scans["schedule"]; set {
		t.Errorf("an advanced interval became schedule %v", scans["schedule"])
	}

	if len(p.Jobs) != 3 {
		t.Errorf("want three jobs, got %v", names(p))
	}
}

func TestFolderSyncListsWhatItLeavesOut(t *testing.T) {
	p := read(t, "foldersync-v1.json")
	for _, n := range []importer.Note{
		{Subject: "Camera", What: "syncRules: FileSizeLargerThan 104857600"},
		{Subject: "Camera", What: "notifyOnError"},
		{Subject: "Documents", What: "webhooks"},
		{Subject: "Music", What: "accountType: Hubic"},
		{Subject: "Scans", What: "syncInterval: Advanced"},
	} {
		if !has(p.Skipped, n.Subject, n.What) {
			t.Errorf("%+v is not listed in %+v", n, p.Skipped)
		}
	}
}

func TestFolderSyncPairsV2(t *testing.T) {
	p := read(t, "foldersync-v2.json")

	cloud := target(t, p, "Cloud")
	if cloud.Type != "webdav" || cloud.Settings["url"] != "https://cloud.example.org/remote.php/dav/files/reeve" ||
		cloud.Settings["vendor"] != "nextcloud" || cloud.Settings["user"] != "reeve" {
		t.Errorf("the Nextcloud account became %+v", cloud)
	}
	archive := target(t, p, "Archive")
	if archive.Type != "s3" || archive.Settings["provider"] != "AWS" || archive.Settings["region"] != "eu-central-1" ||
		archive.Settings["access_key_id"] != "AKIAEXAMPLEKEY" {
		t.Errorf("the S3 account became %+v", archive)
	}
	if !has(p.FillIn, "Archive", importer.SecretKey) {
		t.Errorf("nothing asks for the secret key: %+v", p.FillIn)
	}
	// The phone's own storage is a folder, not a target.
	for _, tg := range p.Targets {
		if tg.Name == "Device" {
			t.Errorf("the device became a target: %+v", tg)
		}
	}

	notes := job(t, p, "Notes")
	expect(t, notes, "left", "/storage/emulated/0/Notes")
	expect(t, notes, "right", "Cloud:Notes")
	expect(t, notes, "direction", "both")
	expect(t, notes, "schedule", "0 * * * *")
	expect(t, notes, "watch", true)
	expect(t, notes, "newerWins", true)
	expect(t, notes, "exclude", []string{".cache/**"})

	photos := job(t, p, "Photos to S3")
	expect(t, photos, "right", "Archive:phone-archive/dcim")
	expect(t, photos, "direction", "leftToRight")
	expect(t, photos, "mode", "mirror")

	for _, n := range []importer.Note{
		{Subject: "Photos to S3", What: "cronString: 0 0 3 ? * * *"},
		{Subject: "Photos to S3", What: "requireCharging"},
		{Subject: "Orphan", What: "accountRightKey: acc-gone"},
	} {
		if !has(p.Skipped, n.Subject, n.What) {
			t.Errorf("%+v is not listed in %+v", n, p.Skipped)
		}
	}
	if len(p.Jobs) != 2 {
		t.Errorf("want two jobs, got %v", names(p))
	}
}

// ArrowLoop runs a two-way job with deletions, so a pair that kept them back
// says so rather than starting to delete.
func TestFolderSyncTwoWayWithoutDeletionsIsNamed(t *testing.T) {
	doc := `{"accounts":[{"name":"Device","accountType":"LocalStorage","importKey":"d"},
		{"name":"Box","accountType":"SFTP","importKey":"b","serverAddress":"box.lan"}],
		"folderPairsV2":[{"accountLeftKey":"d","accountRightKey":"b","name":"Both","leftFolderId":"/x","rightFolderId":"/y",
		"syncDirection":"TwoWay","syncDeletionEnabled":false}]}`
	p, err := importer.Read([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if !has(p.Skipped, "Both", "syncDeletionEnabled: false") {
		t.Errorf("the kept-back deletions are not listed: %+v", p.Skipped)
	}
}
