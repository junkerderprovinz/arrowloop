package job

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func names(jobs []Job) []string {
	out := make([]string, len(jobs))
	for i, j := range jobs {
		out[i] = j.Name
	}
	return out
}

// fileOrder reads the job names straight from the file, in the order they
// stand there.
func fileOrder(t *testing.T, path string) ([]string, map[string]any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse back: %v", err)
	}
	var out []string
	for _, j := range doc["jobs"].([]any) {
		out = append(out, j.(map[string]any)["name"].(string))
	}
	return out, doc
}

const threeJobs = `{"jobs":[
	{"name":"Zeta","left":"/a","right":"/b","state":"z.db"},
	{"name":"Äpfel","left":"/c","right":"/d","state":"a.db"},
	{"name":"birnen","left":"/e","right":"/f","state":"b.db"}]}`

// A person reads the list, so "birnen" comes before "Zeta" and "Äpfel" sits
// with the other a's rather than after every plain letter.
func TestJobsAreListedAlphabeticallyUntilSomebodyOrdersThem(t *testing.T) {
	cfg, err := Load(writeConfig(t, threeJobs))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got, want := names(cfg.Jobs), []string{"Äpfel", "birnen", "Zeta"}; !slices.Equal(got, want) {
		t.Errorf("listed as %v, want %v", got, want)
	}
}

func TestAnOwnOrderKeepsTheJobsWhereTheFileHasThem(t *testing.T) {
	path := writeConfig(t, `{"keepJobOrder":true,"jobs":[
		{"name":"Zeta","left":"/a","right":"/b","state":"z.db"},
		{"name":"Äpfel","left":"/c","right":"/d","state":"a.db"},
		{"name":"birnen","left":"/e","right":"/f","state":"b.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got, want := names(cfg.Jobs), []string{"Zeta", "Äpfel", "birnen"}; !slices.Equal(got, want) {
		t.Errorf("listed as %v, want the file's order %v", got, want)
	}
}

func TestTheFirstMoveWritesTheWholeOrderAndKeepsIt(t *testing.T) {
	path := writeConfig(t, threeJobs)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	next, err := cfg.SaveOrder([]string{"Zeta", "Äpfel", "birnen"})
	if err != nil {
		t.Fatalf("save the order: %v", err)
	}
	if got, want := names(next.Jobs), []string{"Zeta", "Äpfel", "birnen"}; !slices.Equal(got, want) {
		t.Errorf("listed as %v after the move, want %v", got, want)
	}
	inFile, doc := fileOrder(t, path)
	if want := []string{"Zeta", "Äpfel", "birnen"}; !slices.Equal(inFile, want) {
		t.Errorf("the file holds %v, want %v", inFile, want)
	}
	if doc["keepJobOrder"] != true {
		t.Errorf("the file does not say its order is kept: %v", doc["keepJobOrder"])
	}

	again, err := Load(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got, want := names(again.Jobs), []string{"Zeta", "Äpfel", "birnen"}; !slices.Equal(got, want) {
		t.Errorf("a restart lists %v, want %v", got, want)
	}
}

// The list on screen may be a moment old, so a job it did not know about
// stays in the file, behind the ones it ordered.
func TestAnOrderLeavesNoJobOut(t *testing.T) {
	path := writeConfig(t, threeJobs)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	next, err := cfg.SaveOrder([]string{"birnen", "gone", "Zeta"})
	if err != nil {
		t.Fatalf("save the order: %v", err)
	}
	if got, want := names(next.Jobs), []string{"birnen", "Zeta", "Äpfel"}; !slices.Equal(got, want) {
		t.Errorf("listed as %v, want %v", got, want)
	}
}

func TestANewJobGoesToTheEndOfAnOwnOrder(t *testing.T) {
	path := writeConfig(t, threeJobs)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ordered, err := cfg.SaveOrder([]string{"Zeta", "birnen", "Äpfel"})
	if err != nil {
		t.Fatalf("save the order: %v", err)
	}
	added, err := ordered.AddJob(map[string]any{"name": "alpha", "left": "/g", "right": "/h", "state": "g.db"})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if got, want := names(added.Jobs), []string{"Zeta", "birnen", "Äpfel", "alpha"}; !slices.Equal(got, want) {
		t.Errorf("listed as %v, want the new job last: %v", got, want)
	}
}

// Moving a job is not an edit of it, so the commands only the file may set
// stay with their job.
func TestMovingAJobKeepsItsCommands(t *testing.T) {
	path := writeConfig(t, `{"jobs":[
		{"name":"a","left":"/a","right":"/b","state":"a.db","before":"echo hi"},
		{"name":"b","left":"/c","right":"/d","state":"b.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if _, err := cfg.SaveOrder([]string{"b", "a"}); err != nil {
		t.Fatalf("save the order: %v", err)
	}
	_, doc := fileOrder(t, path)
	moved := doc["jobs"].([]any)[1].(map[string]any)
	if moved["name"] != "a" || moved["before"] != "echo hi" {
		t.Errorf("the moved job lost its command: %v", moved)
	}
}
