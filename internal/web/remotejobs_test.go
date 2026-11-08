package web_test

import (
	"encoding/json"
	"maps"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// openedJob is what a paired instance hands over for one of its jobs.
type openedJob struct {
	Job      map[string]any `json:"job"`
	Defaults map[string]any `json:"defaults"`
}

// withCommands is an engine whose one job runs a command after each run and
// follows a default that switches metadata on.
const withCommands = `{"defaults":{"metadata":true},"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","quietPeriod":"0s","after":"curl https://example.invalid/?token=secret"}]}`

// apart is an engine whose job's sides lie outside the folder its
// configuration is in, as on a real install, and the two sides.
func apart(t *testing.T) (config, left, right string) {
	t.Helper()
	base := t.TempDir()
	left, right = filepath.Join(base, "left"), filepath.Join(base, "right")
	for _, d := range []string{left, right} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	config = `{"jobs":[{"name":"photos","left":"` + filepath.ToSlash(left) + `","right":"` + filepath.ToSlash(right) + `","state":"%[1]s/photos.db","quietPeriod":"0s"}]}`
	return config, left, right
}

// pairedPair stands up two instances of one group, a named Attic, and returns
// them with the id each goes by.
func pairedPair(t *testing.T, bConfig string) (a, b *node, aID, bID string) {
	t.Helper()
	url := testRelay(t)
	a = newNode(t, url)
	if bConfig == "" {
		b = newNode(t, url)
	} else {
		b = nodeOn(t, url, "server", engineFor(t, bConfig))
	}
	if status, body := a.send(t, http.MethodPut, "/api/connect", `{"name":"Attic"}`); status != http.StatusOK {
		t.Fatalf("rename = %d %s", status, body)
	}
	aID, bID = pair(t, a, b)
	return a, b, aID, bID
}

// openOn reads job name of instance id through a, once the relay carries it.
func openOn(t *testing.T, a *node, id, name string) openedJob {
	t.Helper()
	var got openedJob
	eventually(t, "the job of the other instance opening", func() bool {
		status, body := a.send(t, http.MethodGet, "/api/instances/"+id+"/jobs/"+url.PathEscape(name)+"/config", "")
		return status == http.StatusOK && json.Unmarshal(body, &got) == nil
	})
	return got
}

// saveOn sends job as the new state of job name on instance id.
func saveOn(t *testing.T, a *node, id, name string, job map[string]any) (int, string) {
	t.Helper()
	body, err := json.Marshal(job)
	if err != nil {
		t.Fatal(err)
	}
	status, out := a.send(t, http.MethodPut, "/api/instances/"+id+"/jobs/"+url.PathEscape(name)+"/config", string(body))
	return status, string(out)
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestAPairedInstanceOpensAJobWithoutItsCommands(t *testing.T) {
	a, b, _, bID := pairedPair(t, withCommands)

	got := openOn(t, a, bID, "photos")
	if got.Job["name"] != "photos" || got.Job["left"] != filepath.ToSlash(b.dir)+"/left" {
		t.Errorf("the job as opened = %v, want photos with the left side it has there", got.Job)
	}
	for key := range got.Job {
		if strings.EqualFold(key, "after") || strings.EqualFold(key, "before") {
			t.Errorf("the job carries its command %q to the other instance", key)
		}
	}
	if got.Defaults["metadata"] != true {
		t.Errorf("the defaults the job follows there = %v, want metadata on", got.Defaults)
	}

	if status, _ := a.send(t, http.MethodGet, "/api/instances/"+bID+"/jobs/nothing/config", ""); status != http.StatusNotFound {
		t.Errorf("a job the other instance does not have = %d, want 404", status)
	}
}

func TestAPairedInstanceSavesAJobThere(t *testing.T) {
	config, left, _ := apart(t)
	a, b, aID, bID := pairedPair(t, config)
	got := openOn(t, a, bID, "photos")

	moved := filepath.ToSlash(filepath.Join(left, "moved"))
	if err := os.MkdirAll(moved, 0o755); err != nil {
		t.Fatal(err)
	}
	got.Job["schedule"] = "0 5 * * *"
	got.Job["left"] = moved
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("saving the job on the other instance = %d %s", status, body)
	}

	var jobs []struct{ Name, Schedule, Left string }
	b.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || jobs[0].Schedule != "0 5 * * *" || filepath.ToSlash(jobs[0].Left) != moved {
		t.Errorf("the owner runs %+v, want the saved job", jobs)
	}

	logged := b.log.String()
	if !strings.Contains(logged, aID) || !strings.Contains(logged, `"Attic"`) || !strings.Contains(logged, "photos") {
		t.Errorf("the owner's log = %q, want the job and the instance that saved it, by name and id", logged)
	}
}

func TestAJobWithCommandsKeepsItsNameAndSidesFromTheGroup(t *testing.T) {
	a, b, _, bID := pairedPair(t, withCommands)
	got := openOn(t, a, bID, "photos")
	before := readFile(t, b.configPath)

	for key, value := range map[string]string{
		"left":  filepath.ToSlash(filepath.Join(b.left, "sub")),
		"right": filepath.ToSlash(filepath.Join(b.right, "sub")),
		"name":  "pictures",
	} {
		changed := maps.Clone(got.Job)
		changed[key] = value
		status, body := saveOn(t, a, bID, "photos", changed)
		if status != http.StatusBadRequest || !strings.Contains(body, `"group-commands"`) {
			t.Errorf("changing %s of a job with commands = %d %s, want 400 group-commands", key, status, body)
		}
	}
	if after := readFile(t, b.configPath); after != before {
		t.Errorf("a refused save changed the owner's file:\n%s", after)
	}

	got.Job["schedule"] = "0 5 * * *"
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("changing the schedule of a job with commands = %d %s", status, body)
	}
	if file := readFile(t, b.configPath); !strings.Contains(file, `"0 5 * * *"`) || !strings.Contains(file, "curl https://example.invalid") {
		t.Errorf("the owner's file after the save:\n%s\nwant the new schedule and the command it had", file)
	}
}

// twoJobs is an engine with a job that runs a command and one that does not.
const twoJobs = `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","quietPeriod":"0s"},{"name":"music","left":"%[1]s/left/music","right":"%[1]s/right/music","state":"%[1]s/music.db","quietPeriod":"0s","after":"echo done"}]}`

func TestARenamedJobTakesNoCommandsOfAnother(t *testing.T) {
	a, b, _, bID := pairedPair(t, twoJobs)
	got := openOn(t, a, bID, "photos")

	got.Job["name"] = "music"
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusBadRequest {
		t.Errorf("renaming a job to the name of one with commands = %d %s, want 400", status, body)
	}
	got.Job["name"] = "pictures"
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("renaming a job without commands = %d %s", status, body)
	}
	var stored struct {
		Jobs []map[string]any `json:"jobs"`
	}
	if err := json.Unmarshal([]byte(readFile(t, b.configPath)), &stored); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, j := range stored.Jobs {
		if j["name"] != "pictures" {
			continue
		}
		found = true
		if j["after"] != nil || j["before"] != nil {
			t.Errorf("the renamed job took a command: %v", j)
		}
	}
	if !found {
		t.Errorf("the owner's file has no job called pictures: %v", stored.Jobs)
	}
}

func TestTheOwnersTrashAndBrakesStayAsTheOwnerSetThem(t *testing.T) {
	a, b, _, bID := pairedPair(t, `{"jobs":[{"name":"photos","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/photos.db","quietPeriod":"0s","brakePercent":25}]}`)
	got := openOn(t, a, bID, "photos")

	got.Job["noTrash"] = true
	got.Job["brakePercent"] = 0
	got.Job["ChangePercent"] = 0
	got.Job["brakeFloor"] = 0
	got.Job["mode"], got.Job["direction"] = "mirror", "leftToRight"
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("save = %d %s", status, body)
	}
	file := readFile(t, b.configPath)
	lower := strings.ToLower(file)
	if strings.Contains(lower, "notrash") || strings.Contains(lower, "changepercent") || strings.Contains(lower, "brakefloor") ||
		!strings.Contains(file, `"brakePercent": 25`) || !strings.Contains(file, `"mirror"`) {
		t.Errorf("the owner's file after the save:\n%s\nwant the new mode with the trash and the brakes as the owner set them", file)
	}
}

func TestASideFromTheGroupStaysUnderTheOwnersFolders(t *testing.T) {
	config, left, right := apart(t)
	// A paused job of the owner's syncs the folder around the one that holds
	// the configuration, which a side from the group still may not reach into.
	around := filepath.Dir(filepath.Dir(left))
	jobs := strings.Replace(config, `]}`, `,{"name":"all","left":"`+filepath.ToSlash(around)+`","right":"`+filepath.ToSlash(right)+`/all","state":"%[1]s/all.db","quietPeriod":"0s","disabled":true}]}`, 1)
	a, b, _, bID := pairedPair(t, jobs)
	got := openOn(t, a, bID, "photos")
	before := readFile(t, b.configPath)

	for side, code := range map[string]string{
		`\\attacker\share\photos`:                       "group-side-share",
		"//attacker/share/photos":                       "group-side-share",
		filepath.ToSlash(filepath.Dir(around)):          "group-side-outside",
		filepath.ToSlash(left) + "/../../..":            "group-side-outside",
		filepath.ToSlash(filepath.Join(b.dir, "state")): "group-side-private",
	} {
		changed := maps.Clone(got.Job)
		changed["left"] = side
		status, body := saveOn(t, a, bID, "photos", changed)
		if status != http.StatusBadRequest || !strings.Contains(body, `"`+code+`"`) {
			t.Errorf("the side %q = %d %s, want 400 %s", side, status, body, code)
		}
	}
	if after := readFile(t, b.configPath); after != before {
		t.Errorf("a refused side changed the owner's file:\n%s", after)
	}

	got.Job["left"] = filepath.ToSlash(filepath.Join(right, "nested"))
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Errorf("a folder under a side the owner uses = %d %s, want 200", status, body)
	}
}

func TestTheGroupBrowsesOnlyWhatItMayChoose(t *testing.T) {
	config, left, right := apart(t)
	a, b, _, bID := pairedPair(t, config)
	openOn(t, a, bID, "photos")
	browse := func(path string) (int, string) {
		status, body := a.send(t, http.MethodGet, "/api/instances/"+bID+"/browse?path="+url.QueryEscape(path), "")
		return status, string(body)
	}

	status, roots := browse("")
	var listed struct {
		Entries []struct{ Path string } `json:"entries"`
	}
	if err := json.Unmarshal([]byte(roots), &listed); status != http.StatusOK || err != nil {
		t.Fatalf("the roots of the other instance = %d %s", status, roots)
	}
	var paths []string
	for _, e := range listed.Entries {
		paths = append(paths, filepath.ToSlash(e.Path))
	}
	want := []string{filepath.ToSlash(left), filepath.ToSlash(right)}
	if !slices.Equal(paths, want) {
		t.Errorf("the roots of the other instance = %q, want the owner's own sides %q", paths, want)
	}

	for _, outside := range []string{b.dir, `\\attacker\share`, filepath.Join(left, "..")} {
		if status, body := browse(outside); status != http.StatusBadRequest {
			t.Errorf("browsing %q = %d %s, want 400", outside, status, body)
		}
	}
	if status, body := browse(left); status != http.StatusOK {
		t.Errorf("browsing a side the owner uses = %d %s", status, body)
	}
}

func TestTheOwnersLogQuotesTheNameAnInstanceGivesItself(t *testing.T) {
	a, b, _, bID := pairedPair(t, "")
	if status, body := a.send(t, http.MethodPut, "/api/connect", `{"name":"Attic\nforged line"}`); status != http.StatusOK {
		t.Fatalf("rename = %d %s", status, body)
	}
	eventually(t, "the new name on the owner", func() bool {
		for _, m := range b.connect(t).Members {
			if m.Name == "Attic\nforged line" {
				return true
			}
		}
		return false
	})
	got := openOn(t, a, bID, "photos")
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("save = %d %s", status, body)
	}
	logged := b.log.String()
	if strings.Contains(logged, "\nforged line") || !strings.Contains(logged, `"Attic\nforged line"`) {
		t.Errorf("the owner's log = %q, want the name quoted on one line", logged)
	}
}

func TestASaveFromAPairedInstanceMeetsTheOwnersRules(t *testing.T) {
	a, b, aID, bID := pairedPair(t, "")
	got := openOn(t, a, bID, "photos")
	before := readFile(t, b.configPath)

	got.Job["schedule"] = "every other tuesday"
	status, body := saveOn(t, a, bID, "photos", got.Job)
	if status != http.StatusBadRequest || !strings.Contains(body, "schedule") {
		t.Errorf("a schedule the owner cannot read = %d %s, want 400 naming the schedule", status, body)
	}
	if after := readFile(t, b.configPath); after != before {
		t.Errorf("a refused save changed the owner's file:\n%s", after)
	}
	if logged := b.log.String(); !strings.Contains(logged, aID) {
		t.Errorf("the owner's log = %q, want the refused save with the instance that sent it", logged)
	}
}

func TestAJobFromAPairedInstanceNamesOnlyTargetsOfTheOwner(t *testing.T) {
	withRcloneConfig(t)
	config, _, right := apart(t)
	a, b, _, bID := pairedPair(t, config)
	if resp, said := b.put(t, "/api/remotes/vault", `{"type":"local","settings":{}}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("making a target on the owner: %s %s", resp.Status, said)
	}
	got := openOn(t, a, bID, "photos")

	for _, side := range []string{
		"nosuch:folder",
		":local:" + filepath.ToSlash(right),
		"vault,copy_links=true:folder",
	} {
		got.Job["right"] = side
		if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusBadRequest {
			t.Errorf("the side %q = %d %s, want 400", side, status, body)
		}
	}

	got.Job["right"] = "vault:" + filepath.ToSlash(right) + "/sub"
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Errorf("a side on a target the owner has = %d %s, want 200", status, body)
	}
}

func TestTheStateDatabaseStaysWhereTheOwnerKeepsIt(t *testing.T) {
	a, b, _, bID := pairedPair(t, "")
	got := openOn(t, a, bID, "photos")
	kept := got.Job["state"]

	got.Job["state"] = filepath.ToSlash(filepath.Join(b.dir, "somewhere", "else.db"))
	if status, body := saveOn(t, a, bID, "photos", got.Job); status != http.StatusOK {
		t.Fatalf("save = %d %s", status, body)
	}
	if again := openOn(t, a, bID, "photos"); again.Job["state"] != kept {
		t.Errorf("the state database after a save from the group = %v, want %v as the owner had it", again.Job["state"], kept)
	}
}

func TestAPairedInstanceListsFoldersAndTargetsByNameOnly(t *testing.T) {
	withRcloneConfig(t)
	config, left, _ := apart(t)
	if err := os.MkdirAll(filepath.Join(left, "2024"), 0o755); err != nil {
		t.Fatal(err)
	}
	a, b, _, bID := pairedPair(t, config)
	body := `{"type":"sftp","settings":{"host":"backup.example","user":"reeve","pass":"the-real-password"}}`
	if resp, said := b.put(t, "/api/remotes/vault", body); resp.StatusCode != http.StatusOK {
		t.Fatalf("making a target on the owner: %s %s", resp.Status, said)
	}
	openOn(t, a, bID, "photos")

	status, places := a.send(t, http.MethodGet, "/api/instances/"+bID+"/places", "")
	if status != http.StatusOK {
		t.Fatalf("places = %d %s", status, places)
	}
	var got struct {
		Targets []map[string]any `json:"targets"`
	}
	if err := json.Unmarshal(places, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Targets) != 1 || got.Targets[0]["name"] != "vault" || got.Targets[0]["type"] != "sftp" {
		t.Errorf("the targets of the other instance = %v, want vault by name and type", got.Targets)
	}
	for _, secret := range []string{"backup.example", "reeve", "the-real-password", "settings"} {
		if strings.Contains(string(places), secret) {
			t.Errorf("the places of the other instance carry %q: %s", secret, places)
		}
	}

	status, listing := a.send(t, http.MethodGet, "/api/instances/"+bID+"/browse?path="+url.QueryEscape(left), "")
	if status != http.StatusOK || !strings.Contains(string(listing), `"2024"`) {
		t.Errorf("the folders of the other instance = %d %s, want 2024", status, listing)
	}
}
