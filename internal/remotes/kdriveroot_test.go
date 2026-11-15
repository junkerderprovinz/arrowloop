package remotes

import (
	"testing"

	_ "github.com/rclone/rclone/backend/kdrive"
	rclonefs "github.com/rclone/rclone/fs"
	"github.com/rclone/rclone/fs/config"
)

func TestTheKdriveFormOffersTheRootFolderUpFront(t *testing.T) {
	for _, b := range Backends() {
		if b.Name != "kdrive" {
			continue
		}
		for _, o := range b.Options {
			if o.Name != "root_folder_id" {
				continue
			}
			if !o.Essential {
				t.Error("root_folder_id waits among the further settings, which the phone never shows")
			}
			if o.Secret {
				t.Error("root_folder_id is drawn as a password, though private, common or a folder ID opens nothing")
			}
			return
		}
		t.Fatal("the kdrive form has no root_folder_id")
	}
	t.Fatal("this build offers no kdrive")
}

func TestASavedKdriveRootFolderReachesTheRemote(t *testing.T) {
	saved(t, "kd", "kdrive", map[string]string{
		"token":          `{"access_token":"x"}`,
		"drive_id":       "123456",
		"root_folder_id": "common",
	})

	for _, r := range List() {
		if r.Name != "kd" {
			continue
		}
		for _, s := range r.Settings {
			if s.Key == "root_folder_id" && (s.Secret || s.Value != "common") {
				t.Errorf("the form gets root_folder_id back as %q (secret %v), want common", s.Value, s.Secret)
			}
		}
	}

	// Runs and the folder picker open the target the same way.
	_, _, _, cfg, err := rclonefs.ConfigFs("kd:")
	if err != nil {
		t.Fatalf("open the saved target: %v", err)
	}
	if got, _ := cfg.Get("root_folder_id"); got != "common" {
		t.Fatalf("rclone opens the target with root_folder_id %q, want common", got)
	}
}

func TestAnEmptiedKdriveRootFolderLeavesTheSection(t *testing.T) {
	saved(t, "kd", "kdrive", map[string]string{"drive_id": "123456", "root_folder_id": "common"})
	if err := Save("kd", "kdrive", map[string]string{"drive_id": "123456", "root_folder_id": ""}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if got, ok := config.LoadedData().GetValue("kd", "root_folder_id"); ok {
		t.Fatalf("root_folder_id stays in the section as %q", got)
	}
}
