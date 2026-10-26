package web_test

import (
	"encoding/json"
	"net/http"
	"testing"

	_ "github.com/rclone/rclone/backend/alias"
	_ "github.com/rclone/rclone/backend/sftp"
	"github.com/rclone/rclone/fs/config"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

func deleteTarget(t *testing.T, h *harness, name string) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, h.srv.URL+"/api/remotes/"+name, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	resp, err := h.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE %s: %v", name, err)
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return resp, body
}

// A job on a deleted target would fail every run, and the target's
// credentials are gone with it. One wrapped in another target counts too.
func TestATargetAJobUsesIsNotDeleted(t *testing.T) {
	withRcloneConfig(t)
	if err := remotes.Save("backup", "sftp", map[string]string{"host": "backup.example", "user": "reeve"}); err != nil {
		t.Fatal(err)
	}
	if err := remotes.Save("inner", "alias", map[string]string{"remote": "backup:photos"}); err != nil {
		t.Fatal(err)
	}
	h := engineFor(t, `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"inner:","state":"%[1]s/photos.db","quietPeriod":"0s"}]}`)

	for _, name := range []string{"backup", "inner"} {
		resp, body := deleteTarget(t, h, name)
		if resp.StatusCode != http.StatusConflict || body["code"] != "target-in-use" {
			t.Errorf("deleting %s answered %s %v, want a refusal", name, resp.Status, body)
		}
		if values, _ := body["values"].(map[string]any); values["jobs"] != "photos" {
			t.Errorf("deleting %s named the jobs %v, want photos", name, body["values"])
		}
		if !config.LoadedData().HasSection(name) {
			t.Errorf("%s was deleted", name)
		}
	}
}

func TestATargetNoJobUsesIsDeleted(t *testing.T) {
	h := newHarness(t)
	withRcloneConfig(t)
	if err := remotes.Save("spare", "sftp", map[string]string{"host": "spare.example"}); err != nil {
		t.Fatal(err)
	}
	if resp, body := deleteTarget(t, h, "spare"); resp.StatusCode != http.StatusOK {
		t.Fatalf("deleting a target no job uses answered %s %v", resp.Status, body)
	}
}
