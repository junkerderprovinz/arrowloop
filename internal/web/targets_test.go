package web_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/rclone/rclone/backend/s3"
	_ "github.com/rclone/rclone/backend/sftp"
	_ "github.com/rclone/rclone/backend/smb"
	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

type volumeList struct {
	Volumes []struct {
		ID       string `json:"id"`
		Label    string `json:"label"`
		Mount    string `json:"mount"`
		Attached bool   `json:"attached"`
		Path     string `json:"path"`
	} `json:"volumes"`
}

// TestMarkingADriveThroughTheScreen is the whole flow somebody actually
// performs: plug a disk in, give it a name, and get back the string a job
// stores. The identity is never typed by a person, which is the point.
func TestMarkingADriveThroughTheScreen(t *testing.T) {
	h := newHarness(t)
	drive := t.TempDir()
	realCandidates := volume.Candidates
	volume.Candidates = func() []string { return []string{drive} }
	t.Cleanup(func() { volume.Candidates = realCandidates })

	resp := h.post(t, "/api/volumes", `{"mount":`+quote(drive)+`,"label":"Backup drive"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("marking a drive: %s", resp.Status)
	}
	var marked struct {
		ID   string `json:"id"`
		Path string `json:"path"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&marked); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if marked.Path != "volume:"+marked.ID {
		t.Fatalf("the screen was given %q, which is not what a job stores", marked.Path)
	}

	var list volumeList
	h.get(t, "/api/volumes", &list)
	if len(list.Volumes) != 1 || !list.Volumes[0].Attached || list.Volumes[0].Label != "Backup drive" {
		t.Fatalf("the marked drive is not listed as attached: %+v", list.Volumes)
	}

	// Unplugged: still listed, still named, no longer attached.
	volume.Candidates = func() []string { return nil }
	h.get(t, "/api/volumes", &list)
	if len(list.Volumes) != 1 {
		t.Fatalf("an unplugged drive vanished from the list: %+v", list.Volumes)
	}
	if list.Volumes[0].Attached {
		t.Error("an unplugged drive is listed as attached")
	}
	if list.Volumes[0].Label != "Backup drive" {
		t.Errorf("an unplugged drive lost its name and is listed as %q", list.Volumes[0].Label)
	}

	req, err := http.NewRequest(http.MethodDelete, h.srv.URL+"/api/volumes/"+marked.ID, nil)
	if err != nil {
		t.Fatalf("build the request: %v", err)
	}
	forgotten, err := h.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("forget: %v", err)
	}
	forgotten.Body.Close()

	h.get(t, "/api/volumes", &list)
	if len(list.Volumes) != 0 {
		t.Errorf("a forgotten drive is still listed: %+v", list.Volumes)
	}
	// The marker itself is left on the disk, so plugging it back in brings it
	// back rather than asking for a new name.
	if _, err := os.Stat(filepath.Join(drive, ".arrowloop", "volume.json")); err != nil {
		t.Errorf("forgetting a drive deleted the marker on it: %v", err)
	}
}

// TestTheBackendsOfferedAreTheOnesBuiltIn. A screen that offers a backend the
// binary does not carry produces a job that fails on its first run with an
// error about a missing configuration section, which points at the wrong thing
// entirely.
func TestTheBackendsOfferedAreTheOnesBuiltIn(t *testing.T) {
	h := newHarness(t)
	var got struct {
		Backends []struct {
			Name    string `json:"name"`
			Options []struct {
				Name     string `json:"name"`
				Required bool   `json:"required"`
				Secret   bool   `json:"secret"`
			} `json:"options"`
		} `json:"backends"`
	}
	h.get(t, "/api/remotes", &got)

	offered := map[string]bool{}
	for _, b := range got.Backends {
		offered[b.Name] = true
	}
	// The three the product promises beyond a plain local path.
	for _, want := range []string{"s3", "sftp", "smb"} {
		if !offered[want] {
			t.Errorf("%s is promised and not offered", want)
		}
	}
	if offered["local"] {
		t.Error("local is offered as a remote, which asks somebody to name the folder they are looking at")
	}
	// A backend nobody compiled in must not appear.
	if offered["dropbox"] {
		t.Error("a backend this build cannot reach is offered")
	}

	// And every password field must be marked, or the screen will show one.
	for _, b := range got.Backends {
		if b.Name != "sftp" {
			continue
		}
		var checked int
		for _, o := range b.Options {
			if o.Name == "pass" || o.Name == "key_pem" {
				checked++
				if !o.Secret {
					t.Errorf("sftp %s is not marked as a secret", o.Name)
				}
			}
			if o.Name == "host" && o.Secret {
				t.Error("sftp host is marked as a secret, which would hide it from the person typing it")
			}
		}
		if checked != 2 {
			t.Errorf("only %d of the two sftp secrets were found at all", checked)
		}
	}
}

// TestASecretNeverLeavesTheProcess is the one that matters. A screen that shows
// a stored password to whoever opens it has undone the point of storing it
// obscured.
func TestASecretNeverLeavesTheProcess(t *testing.T) {
	h := newHarness(t)
	withRcloneConfig(t)

	body := `{"type":"sftp","settings":{"host":"backup.example","user":"reeve","pass":"the-real-password"}}`
	resp, said := h.put(t, "/api/remotes/backup", body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("saving a remote: %s %s", resp.Status, said)
	}

	var got struct {
		Remotes []struct {
			Name     string `json:"name"`
			Type     string `json:"type"`
			Settings []struct {
				Key    string `json:"key"`
				Value  string `json:"value"`
				Secret bool   `json:"secret"`
			} `json:"settings"`
		} `json:"remotes"`
	}
	h.get(t, "/api/remotes", &got)

	var found bool
	for _, r := range got.Remotes {
		if r.Name != "backup" {
			continue
		}
		found = true
		for _, s := range r.Settings {
			if strings.Contains(s.Value, "the-real-password") {
				t.Fatalf("the password came back over the wire in %s", s.Key)
			}
			switch s.Key {
			case "pass":
				if !s.Secret || s.Value != remotes.Placeholder {
					t.Errorf("a set password reported itself as %q, secret=%v", s.Value, s.Secret)
				}
			case "host":
				if s.Value != "backup.example" {
					t.Errorf("the host came back as %q", s.Value)
				}
			}
		}
	}
	if !found {
		t.Fatal("the saved remote is not listed")
	}

	// Editing the host and sending the placeholder back must leave the password
	// alone. Without that rule, changing an address in a form silently replaces
	// the password with eight asterisks and the job fails on its next run.
	edit := `{"type":"sftp","settings":{"host":"other.example","user":"reeve","pass":"` + remotes.Placeholder + `"}}`
	if resp, said = h.put(t, "/api/remotes/backup", edit); resp.StatusCode != http.StatusOK {
		t.Fatalf("editing the remote: %s %s", resp.Status, said)
	}

	raw := readRcloneConfig(t)
	if strings.Contains(raw, remotes.Placeholder) {
		t.Fatal("editing another field replaced the stored password with the placeholder")
	}
	if !strings.Contains(raw, "other.example") {
		t.Error("the edit did not take")
	}
}

func quote(s string) string {
	out, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(out)
}

// withRcloneConfig points rclone at a configuration file this test owns.
//
// Without it these tests would write remotes into whatever rclone.conf the
// machine running them happens to have, which is somebody's real one.
func withRcloneConfig(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("create a configuration file: %v", err)
	}
	previous := config.GetConfigPath()
	if err := config.SetConfigPath(path); err != nil {
		t.Fatalf("point rclone at it: %v", err)
	}
	configfile.Install()
	t.Cleanup(func() {
		_ = config.SetConfigPath(previous)
		configfile.Install()
	})
	return path
}

func readRcloneConfig(t *testing.T) string {
	t.Helper()
	body, err := os.ReadFile(config.GetConfigPath())
	if err != nil {
		t.Fatalf("read the configuration: %v", err)
	}
	return string(body)
}
