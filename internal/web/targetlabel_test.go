package web_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/rclone/rclone/backend/alias"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

type targetList struct {
	Remotes []struct {
		Name  string `json:"name"`
		Label string `json:"label"`
	} `json:"remotes"`
}

func (h *harness) targets(t *testing.T) targetList {
	t.Helper()
	var got targetList
	h.get(t, "/api/remotes", &got)
	return got
}

func (h *harness) runAndWait(t *testing.T, runs int) {
	t.Helper()
	resp := h.post(t, "/api/jobs/photos/run", ``)
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("run: %s", resp.Status)
	}
	waitForRun(t, h, runs)
}

func addTarget(t *testing.T, h *harness, body string) (*http.Response, map[string]any) {
	t.Helper()
	resp := h.post(t, "/api/remotes", body)
	defer resp.Body.Close()
	var said map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&said)
	return resp, said
}

// A setup from an earlier version names its targets in rclone.conf and has its
// jobs write those names before the colon. It keeps working as it is, through
// a rename and through a restore of a backup the earlier version made.
func TestAnOldSetupKeepsItsJobsOnTheirTargetsThroughARename(t *testing.T) {
	path := withRcloneConfig(t)
	old := `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"OneDriveB:","state":"%[1]s/photos.db","quietPeriod":"0s"}]}`
	h := engineFor(t, old)
	if err := os.WriteFile(path, []byte("[OneDriveB]\ntype = alias\nremote = "+h.right+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	configfile.Install()
	config.LoadedData()
	backup, err := os.ReadFile(h.configPath)
	if err != nil {
		t.Fatal(err)
	}

	if got := h.targets(t).Remotes; len(got) != 1 || got[0].Name != "OneDriveB" || got[0].Label != "OneDriveB" {
		t.Fatalf("the old target is listed as %+v", got)
	}
	write(t, h.left, "before.txt", "x")
	h.runAndWait(t, 1)

	rename := `{"type":"alias","settings":{"remote":` + quote(h.right) + `},"label":"OneDrive - Business"}`
	if resp, said := h.put(t, "/api/remotes/OneDriveB", rename); resp.StatusCode != http.StatusOK {
		t.Fatalf("rename: %s %s", resp.Status, said)
	}
	if got := h.targets(t).Remotes; len(got) != 1 || got[0].Name != "OneDriveB" || got[0].Label != "OneDrive - Business" {
		t.Fatalf("after the rename the target is listed as %+v", got)
	}
	if now, _ := os.ReadFile(h.configPath); string(now) != string(backup) {
		t.Errorf("the rename rewrote the jobs:\n%s", now)
	}
	write(t, h.left, "after.txt", "x")
	h.runAndWait(t, 2)

	if resp, said := h.put(t, "/api/config/raw", string(backup)); resp.StatusCode != http.StatusOK {
		t.Fatalf("restoring the old backup: %s %s", resp.Status, said)
	}
	write(t, h.left, "restored.txt", "x")
	h.runAndWait(t, 3)

	for _, name := range []string{"before.txt", "after.txt", "restored.txt"} {
		if _, err := os.Stat(filepath.Join(h.right, name)); err != nil {
			t.Errorf("%s did not reach the target: %v", name, err)
		}
	}
	if resp, _ := deleteTarget(t, h, "OneDriveB"); resp.StatusCode != http.StatusConflict {
		t.Errorf("the renamed target was deleted under the job that uses it: %s", resp.Status)
	}
}

func TestATargetIsAddedUnderTheNameSomebodyTyped(t *testing.T) {
	h := newHarness(t)
	withRcloneConfig(t)

	resp, said := addTarget(t, h, `{"label":"OneDrive - Business","type":"alias","settings":{"remote":`+quote(h.right)+`}}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("adding a target: %s %v", resp.Status, said)
	}
	id, _ := said["saved"].(string)
	if id == "" || strings.ContainsAny(id, " :") {
		t.Fatalf("the new target was given the id %q", id)
	}
	if got := h.targets(t).Remotes; len(got) != 1 || got[0].Name != id || got[0].Label != "OneDrive - Business" {
		t.Fatalf("the new target is listed as %+v", got)
	}
	if !strings.Contains(readRcloneConfig(t), "["+id+"]") {
		t.Errorf("rclone.conf has no section %s", id)
	}
}

// Two targets of one name cannot be told apart in a job's choice of target,
// so the second is refused with a code the page says in the reader's words.
func TestASecondTargetOfOneNameIsRefusedWithACode(t *testing.T) {
	h := newHarness(t)
	withRcloneConfig(t)

	body := `{"label":"Backup","type":"alias","settings":{"remote":` + quote(h.right) + `}}`
	if resp, said := addTarget(t, h, body); resp.StatusCode != http.StatusOK {
		t.Fatalf("adding a target: %s %v", resp.Status, said)
	}
	resp, said := addTarget(t, h, body)
	if resp.StatusCode != http.StatusConflict || said["code"] != "target-name-taken" {
		t.Fatalf("a second target called Backup answered %s %v", resp.Status, said)
	}
	values, _ := said["values"].(map[string]any)
	if values["name"] != "Backup" {
		t.Errorf("the refusal names %v", values)
	}

	other := `{"label":"Archive","type":"alias","settings":{"remote":` + quote(h.left) + `}}`
	_, made := addTarget(t, h, other)
	id, _ := made["saved"].(string)
	rename := `{"type":"alias","settings":{},"label":"Backup"}`
	if resp, said := h.put(t, "/api/remotes/"+id, rename); resp.StatusCode != http.StatusConflict || !strings.Contains(said, "target-name-taken") {
		t.Errorf("renaming a target to another's name answered %s %s", resp.Status, said)
	}
	if len(h.targets(t).Remotes) != 2 {
		t.Errorf("the refusals left %+v", h.targets(t).Remotes)
	}
}

// A target called what somebody likes is walked, used and renamed by its id,
// which is what a job's side holds before the folder.
func TestATargetWithAFreeNameCarriesAJobThroughARename(t *testing.T) {
	h := newHarness(t)
	withRcloneConfig(t)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "home", "user", "folder"), 0o755); err != nil {
		t.Fatal(err)
	}

	_, said := addTarget(t, h, `{"label":"SFTP Home Lab","type":"alias","settings":{"remote":`+quote(root)+`}}`)
	id, _ := said["saved"].(string)
	if id == "" {
		t.Fatalf("adding the target answered %v", said)
	}

	var at browseAnswer
	for _, step := range []string{"home", "user", "folder"} {
		path := id + ":"
		if at.Path != "" {
			path = at.Path
		}
		h.get(t, "/api/browse?path="+url.QueryEscape(path), &at)
		var next string
		for _, e := range at.Entries {
			if e.Name == step {
				next = e.Path
			}
		}
		if next == "" {
			t.Fatalf("%s lists %+v, without %s", path, at.Entries, step)
		}
		at.Path = next
	}
	if at.Path != id+":home/user/folder" {
		t.Fatalf("the picked folder is %q, not on the target's id", at.Path)
	}
	var shown browseAnswer
	h.get(t, "/api/browse?path="+url.QueryEscape(at.Path), &shown)
	if shown.Shown != "SFTP Home Lab: home/user/folder" {
		t.Errorf("the picker reads the folder as %q", shown.Shown)
	}

	job := `{"jobs":[{"name":"photos","left":` + quote(filepath.ToSlash(h.left)) + `,"right":` + quote(at.Path) +
		`,"state":` + quote(filepath.ToSlash(filepath.Join(h.dir, "photos.db"))) + `,"quietPeriod":"0s"}]}`
	if resp, said := h.put(t, "/api/config/raw", job); resp.StatusCode != http.StatusOK {
		t.Fatalf("pointing the job at the target: %s %s", resp.Status, said)
	}
	written, _ := os.ReadFile(h.configPath)
	write(t, h.left, "one.txt", "x")
	h.runAndWait(t, 1)

	rename := `{"type":"alias","settings":{},"label":"OneDrive - Business"}`
	if resp, said := h.put(t, "/api/remotes/"+id, rename); resp.StatusCode != http.StatusOK {
		t.Fatalf("rename: %s %s", resp.Status, said)
	}
	if now, _ := os.ReadFile(h.configPath); string(now) != string(written) {
		t.Errorf("the rename rewrote the job:\n%s", now)
	}
	write(t, h.left, "two.txt", "x")
	h.runAndWait(t, 2)

	for _, name := range []string{"one.txt", "two.txt"} {
		if _, err := os.Stat(filepath.Join(root, "home", "user", "folder", name)); err != nil {
			t.Errorf("%s did not reach the folder on the target: %v", name, err)
		}
	}
	if got := h.targets(t).Remotes; len(got) != 1 || got[0].Name != id || got[0].Label != "OneDrive - Business" {
		t.Errorf("after the rename the target is listed as %+v", got)
	}
}
