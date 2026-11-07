package importer_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/importer"
)

func read(t *testing.T, name string) importer.Plan {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	p, err := importer.Read(data)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return p
}

func job(t *testing.T, p importer.Plan, name string) map[string]any {
	t.Helper()
	for _, j := range p.Jobs {
		if j["name"] == name {
			return j
		}
	}
	t.Fatalf("no job %q among %v", name, names(p))
	return nil
}

func names(p importer.Plan) []string {
	var out []string
	for _, j := range p.Jobs {
		out = append(out, j["name"].(string))
	}
	return out
}

func target(t *testing.T, p importer.Plan, name string) importer.Target {
	t.Helper()
	for _, tg := range p.Targets {
		if tg.Name == name {
			return tg
		}
	}
	t.Fatalf("no target %q among %+v", name, p.Targets)
	return importer.Target{}
}

func has(notes []importer.Note, subject, what string) bool {
	return slices.Contains(notes, importer.Note{Subject: subject, What: what})
}

func expect(t *testing.T, j map[string]any, key string, want any) {
	t.Helper()
	got := j[key]
	if w, ok := want.([]string); ok {
		g, _ := got.([]string)
		if !slices.Equal(g, w) {
			t.Errorf("job %v: %s is %v, want %v", j["name"], key, got, want)
		}
		return
	}
	if got != want {
		t.Errorf("job %v: %s is %#v, want %#v", j["name"], key, got, want)
	}
}

func TestAnUnknownFileIsRefused(t *testing.T) {
	for _, doc := range []string{"", "hello", `{"something":"else"}`, `[1,2,3]`} {
		if _, err := importer.Read([]byte(doc)); !errors.Is(err, importer.ErrUnknown) {
			t.Errorf("%q gave %v, want ErrUnknown", doc, err)
		}
	}
}

// Our own backups go through the restore, which replaces everything, so Read
// only names them.
func TestAnArrowLoopBackupIsRecognised(t *testing.T) {
	for _, doc := range []string{
		`{"jobs":[]}`,
		`{"Jobs":[{"name":"a"}],"bwlimit":"off"}`,
		`{"kind":"arrowloop-settings","version":1,"settings":{},"config":{"jobs":[]}}`,
	} {
		p, err := importer.Read([]byte(doc))
		if err != nil || p.Source != importer.ArrowLoop {
			t.Errorf("%s read as %q, %v", doc, p.Source, err)
		}
		if len(p.Jobs) != 0 || len(p.Targets) != 0 {
			t.Errorf("%s brought jobs or targets: %+v", doc, p)
		}
	}
}

// Every job arrives paused: its folders come from another machine, and a
// mirror pointed at the wrong one deletes.
func TestImportedJobsArrivePaused(t *testing.T) {
	for _, file := range []string{"foldersync-v1.json", "foldersync-v2.json", "luckybackup.profile"} {
		for _, j := range read(t, file).Jobs {
			if j["disabled"] != true {
				t.Errorf("%s: job %v is not paused", file, j["name"])
			}
		}
	}
}

func TestNoSecretComesAlong(t *testing.T) {
	for _, file := range []string{"foldersync-v1.json", "foldersync-v2.json", "luckybackup.profile"} {
		p := read(t, file)
		out, _ := json.Marshal(p)
		if strings.Contains(string(out), "not-a-real-password") {
			t.Errorf("%s: the password from the file is in the plan", file)
		}
		for _, tg := range p.Targets {
			for key := range tg.Settings {
				switch key {
				case "pass", "password", "secret_access_key", "token", "key_file_pass":
					t.Errorf("%s: target %s carries %s", file, tg.Name, key)
				}
			}
		}
	}
}

func TestEveryPlanListIsAnArray(t *testing.T) {
	p, err := importer.Read([]byte(`{"jobs":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(p)
	for _, key := range []string{`"jobs":[]`, `"targets":[]`, `"fillIn":[]`, `"skipped":[]`} {
		if !strings.Contains(string(out), key) {
			t.Errorf("%s is missing %s", out, key)
		}
	}
}

func TestSettleRenamesWhatIsTaken(t *testing.T) {
	p := importer.Plan{
		Jobs: []map[string]any{
			{"name": "Photos", "left": "/a", "right": "nas:/photos"},
			{"name": "Photos", "left": "/b", "right": "nas:/more"},
		},
		Targets: []importer.Target{{Name: "nas", Type: "sftp", Settings: map[string]string{}}},
		FillIn:  []importer.Note{{Subject: "nas", What: importer.Password}},
		Skipped: []importer.Note{{Subject: "Photos", What: "webhooks"}},
	}
	importer.Settle(&p,
		func(name string) bool { return name == "Photos" },
		func(name string) bool { return name == "nas" })

	if got := names(p); !slices.Equal(got, []string{"Photos 2", "Photos 3"}) {
		t.Errorf("jobs are called %v", got)
	}
	if p.Targets[0].Name != "nas-2" {
		t.Errorf("the target is called %q", p.Targets[0].Name)
	}
	if p.Jobs[0]["right"] != "nas-2:/photos" || p.Jobs[1]["right"] != "nas-2:/more" {
		t.Errorf("the sides did not follow the target: %v, %v", p.Jobs[0]["right"], p.Jobs[1]["right"])
	}
	if p.FillIn[0].Subject != "nas-2" {
		t.Errorf("the note still names %q", p.FillIn[0].Subject)
	}
}
