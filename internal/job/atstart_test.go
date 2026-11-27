package job

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAJobSaysWhetherItRunsAtStart(t *testing.T) {
	cfg, err := Load(writeConfig(t, `{"jobs":[
		{"name":"a","left":"/a","right":"/b","state":"a.db","runAtStart":true},
		{"name":"b","left":"/a","right":"/b","state":"b.db","runAtStart":"due"},
		{"name":"c","left":"/a","right":"/b","state":"c.db","runAtStart":false},
		{"name":"d","left":"/a","right":"/b","state":"d.db"}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []AtStart{AtStartAlways, AtStartWhenDue, "", ""}
	for i, j := range cfg.Jobs {
		if j.RunAtStart != want[i] {
			t.Errorf("%s runs at start %q, want %q", j.Name, j.RunAtStart, want[i])
		}
	}
}

// An older version reads true and nothing else, so a job that always runs at
// start keeps the file it had.
func TestRunAtStartIsWrittenAsTheFileHadIt(t *testing.T) {
	for at, want := range map[AtStart]string{
		AtStartAlways:  `"runAtStart":true`,
		AtStartWhenDue: `"runAtStart":"due"`,
	} {
		b, err := json.Marshal(Job{Name: "a", RunAtStart: at})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), want) {
			t.Errorf("%q is written as %s, want %s", at, b, want)
		}
	}
	b, err := json.Marshal(Job{Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "runAtStart") {
		t.Errorf("a job that waits for its schedule writes %s", b)
	}
}

func TestAnUnknownRunAtStartIsRefused(t *testing.T) {
	_, err := Load(writeConfig(t, `{"jobs":[{"name":"a","left":"/a","right":"/b","state":"a.db","runAtStart":"sometimes"}]}`))
	if err == nil || !strings.Contains(err.Error(), "runAtStart") {
		t.Errorf("load gave %v, want runAtStart refused", err)
	}
}
