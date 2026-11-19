package job

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/junkerderprovinz/arrowloop/internal/jobid"
)

// fileJobs reads the job list back as the file on disk holds it.
func fileJobs(t *testing.T, path string) []map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Jobs []map[string]any `json:"jobs"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return doc.Jobs
}

func TestAJobWithoutAnIDGetsTheOneItsNameGivesAndKeepsIt(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"name":"photos","left":"/a","right":"/b","state":"p.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	want := jobid.Legacy("photos")
	if cfg.Jobs[0].ID != want {
		t.Errorf("the job got the id %q, want %q, which its old runs are filed under", cfg.Jobs[0].ID, want)
	}
	if got := fileJobs(t, path); got[0]["id"] != want {
		t.Errorf("the file holds %v, want the id written back", got)
	}
	again, err := Load(path)
	if err != nil || again.Jobs[0].ID != want {
		t.Errorf("a second load gave %q, want the same id", again.Jobs[0].ID)
	}
}

func TestAnUnwritableFileGetsTheSameIDsOnEveryStart(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"name":"photos","left":"/a","right":"/b","state":"p.db"}]}`)
	first, err := load(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := load(path)
	if err != nil {
		t.Fatal(err)
	}
	if first.Jobs[0].ID == "" || first.Jobs[0].ID != second.Jobs[0].ID {
		t.Errorf("two loads gave %q and %q, want one id", first.Jobs[0].ID, second.Jobs[0].ID)
	}
}

func TestARenameKeepsTheIDAndANewJobGetsItsOwn(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"aaaaaaaaaaaa","name":"photos","left":"/a","right":"/b","state":"p.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.SaveJobs([]map[string]any{
		{"id": "aaaaaaaaaaaa", "name": "pictures", "left": "/a", "right": "/b", "state": "p.db"},
		{"name": "music", "left": "/c", "right": "/d", "state": "m.db"},
	})
	if err != nil {
		t.Fatal(err)
	}
	pictures, ok := next.Find("aaaaaaaaaaaa")
	if !ok || pictures.Name != "pictures" {
		t.Errorf("the id finds %+v, want the renamed job", pictures)
	}
	music, _ := next.Find("music")
	if music.ID == "" || music.ID == pictures.ID {
		t.Errorf("the new job got the id %q, want one of its own", music.ID)
	}
}

func TestACopyCarryingTheOriginalsIDGetsANewOne(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"aaaaaaaaaaaa","name":"photos","left":"/a","right":"/b","state":"p.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	// The copy comes first, so first come cannot be what decides.
	next, err := cfg.SaveJobs([]map[string]any{
		{"id": "aaaaaaaaaaaa", "name": "photos-copy", "left": "/a", "right": "/b", "state": "c.db", "disabled": true},
		{"id": "aaaaaaaaaaaa", "name": "photos", "left": "/a", "right": "/b", "state": "p.db"},
	})
	if err != nil {
		t.Fatal(err)
	}
	original, _ := next.Find("photos")
	copied, _ := next.Find("photos-copy")
	if original.ID != "aaaaaaaaaaaa" || copied.ID == "" || copied.ID == original.ID {
		t.Errorf("the original has %q and the copy %q, want the original keeping its id", original.ID, copied.ID)
	}
}

func TestAListWithoutIDsKeepsTheIDsOfItsNamesakes(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"aaaaaaaaaaaa","name":"photos","left":"/a","right":"/b","state":"p.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.Replace([]byte(`{"jobs":[{"name":"photos","left":"/a","right":"/b","state":"p.db","schedule":"0 4 * * *"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if next.Jobs[0].ID != "aaaaaaaaaaaa" {
		t.Errorf("the job came back with %q, want the id it had", next.Jobs[0].ID)
	}
}

func TestTwoJobsWithOneIDInTheFileAreToldApart(t *testing.T) {
	path := writeConfig(t, `{"jobs":[
		{"id":"aaaaaaaaaaaa","name":"photos","left":"/a","right":"/b","state":"p.db"},
		{"id":"aaaaaaaaaaaa","name":"music","left":"/c","right":"/d","state":"m.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	photos, _ := cfg.Find("photos")
	music, _ := cfg.Find("music")
	if photos.ID != "aaaaaaaaaaaa" || music.ID != jobid.Legacy("music") {
		t.Errorf("photos has %q and music %q, want the first keeping the id and the second its own", photos.ID, music.ID)
	}
	if got := fileJobs(t, path); got[1]["id"] != music.ID {
		t.Errorf("the file holds %v, want the second job's new id written back", got)
	}
}

func TestARenamedJobKeepsItsCommands(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"aaaaaaaaaaaa","name":"photos","left":"/a","right":"/b","state":"p.db","before":"mount-it"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.SaveJobs([]map[string]any{
		{"id": "aaaaaaaaaaaa", "name": "pictures", "left": "/a", "right": "/b", "state": "p.db"},
		{"name": "photos", "left": "/c", "right": "/d", "state": "n.db", "before": "rm -rf /"},
	})
	if err != nil {
		t.Fatal(err)
	}
	pictures, _ := next.Find("pictures")
	photos, _ := next.Find("photos")
	if pictures.Before != "mount-it" || photos.Before != "" {
		t.Errorf("pictures runs %q and the new photos %q, want the command to follow the renamed job alone", pictures.Before, photos.Before)
	}
}

func TestAJobsOwnCheckFollowsItsRename(t *testing.T) {
	path := writeConfig(t, `{
	  "notify": {"channels": [{"id": "hc", "kind": "healthchecks", "enabled": true,
	    "healthchecks": {"url": "https://hc.example/ping/all", "byKey": {"photos": "https://hc.example/ping/photos"}}}]},
	  "jobs": [{"id":"aaaaaaaaaaaa","name":"photos","left":"/a","right":"/b","state":"p.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.SaveJobs([]map[string]any{
		{"id": "aaaaaaaaaaaa", "name": "pictures", "left": "/a", "right": "/b", "state": "p.db"},
	})
	if err != nil {
		t.Fatal(err)
	}
	own := next.Notify.Channels[0].Healthchecks.ByKey
	if own["pictures"] != "https://hc.example/ping/photos" || own["photos"] != "" {
		t.Errorf("the job's own checks are %v, want the check under the new name", own)
	}
}

func TestSaveOrderTakesIDsAndNames(t *testing.T) {
	path := writeConfig(t, `{"jobs":[
		{"id":"aaaaaaaaaaaa","name":"a","left":"/a","right":"/b","state":"a.db"},
		{"id":"bbbbbbbbbbbb","name":"b","left":"/c","right":"/d","state":"b.db"},
		{"id":"cccccccccccc","name":"c","left":"/e","right":"/f","state":"c.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.SaveOrder([]string{"cccccccccccc", "a", "bbbbbbbbbbbb"})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, j := range next.Jobs {
		got = append(got, j.Name)
	}
	if len(got) != 3 || got[0] != "c" || got[1] != "a" || got[2] != "b" {
		t.Errorf("the order is %v, want c a b", got)
	}
}
