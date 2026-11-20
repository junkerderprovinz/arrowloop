package job

import (
	"os"
	"path/filepath"
	"testing"
)

const photosID = "aaaaaaaaaaaa"

// withDatabase writes a database and its sidecars at the state path p, as
// written in the file beside path.
func withDatabase(t *testing.T, path, p string) {
	t.Helper()
	full := filepath.Join(filepath.Dir(path), filepath.FromSlash(p))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, s := range sidecars {
		if err := os.WriteFile(full+s, []byte("record"+s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// holds reports which of a database's files are at the state path p.
func holds(t *testing.T, path, p string) []string {
	t.Helper()
	full := filepath.Join(filepath.Dir(path), filepath.FromSlash(p))
	var there []string
	for _, s := range sidecars {
		if _, err := os.Stat(full + s); err == nil {
			there = append(there, "db"+s)
		}
	}
	return there
}

func quiet(string, ...any) {}

func TestANewJobsDatabaseIsNamedAfterItsID(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"`+photosID+`","name":"photos","left":"/a","right":"/b","state":"state/photos.db"}]}`)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.SaveJobs([]map[string]any{
		{"id": photosID, "name": "photos", "left": "/a", "right": "/b", "state": "state/photos.db"},
		{"name": "music", "left": "/c", "right": "/d", "state": "state/New job.db"},
	})
	if err != nil {
		t.Fatal(err)
	}
	music, _ := next.Find("music")
	if want := filepath.Join(next.Dir(), "state", music.ID+".db"); music.State != want {
		t.Errorf("the new job keeps its record in %s, want %s", music.State, want)
	}
	photos, _ := next.Find(photosID)
	if want := filepath.Join(next.Dir(), "state", "photos.db"); photos.State != want {
		t.Errorf("the job that was there moved to %s, want it left at %s", photos.State, want)
	}

	added, err := next.AddJobs(map[string]any{"name": "films", "left": "/e", "right": "/f"})
	if err != nil {
		t.Fatal(err)
	}
	films, _ := added.Find("films")
	if want := filepath.Join(added.Dir(), "state", films.ID+".db"); films.State != want {
		t.Errorf("a job added without a state path keeps its record in %s, want %s", films.State, want)
	}
}

func TestANewJobKeepsADatabaseItIsPointedAt(t *testing.T) {
	path := writeConfig(t, `{"jobs":[]}`)
	withDatabase(t, path, "state/photos.db")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	next, err := cfg.SaveJobs([]map[string]any{
		{"name": "photos", "left": "/a", "right": "/b", "state": "state/photos.db"},
		{"name": "music", "left": "/c", "right": "/d", "state": "records/music.db"},
	})
	if err != nil {
		t.Fatal(err)
	}
	photos, _ := next.Find("photos")
	if want := filepath.Join(next.Dir(), "state", "photos.db"); photos.State != want {
		t.Errorf("a job set up again on its old record keeps %s, want %s", photos.State, want)
	}
	music, _ := next.Find("music")
	if want := filepath.Join(next.Dir(), "records", "music.db"); music.State != want {
		t.Errorf("a path outside the state folder became %s, want %s", music.State, want)
	}
}

func TestARenamedJobKeepsItsDatabase(t *testing.T) {
	for _, state := range []string{"state/" + photosID + ".db", "state/photos.db"} {
		path := writeConfig(t, `{"jobs":[{"id":"`+photosID+`","name":"photos","left":"/a","right":"/b","state":"`+state+`"}]}`)
		cfg, err := Load(path)
		if err != nil {
			t.Fatal(err)
		}
		next, err := cfg.SaveJobs([]map[string]any{
			{"id": photosID, "name": "pictures", "left": "/a", "right": "/b", "state": state},
		})
		if err != nil {
			t.Fatal(err)
		}
		if got, want := next.Jobs[0].State, filepath.Join(next.Dir(), filepath.FromSlash(state)); got != want {
			t.Errorf("after the rename the job keeps its record in %s, want %s", got, want)
		}
	}
}

func TestANameBasedDatabaseMovesToTheIDAtStart(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"`+photosID+`","name":"A and B","left":"/a","right":"/b","state":"state/new-job.db"}]}`)
	withDatabase(t, path, "state/new-job.db")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}

	next := cfg.StateByID(quiet)

	target := "state/" + photosID + ".db"
	if want := filepath.Join(cfg.Dir(), "state", photosID+".db"); next.Jobs[0].State != want {
		t.Errorf("the job reads its record from %s, want %s", next.Jobs[0].State, want)
	}
	if got := holds(t, path, target); len(got) != 3 {
		t.Errorf("the new name holds %v, want the database with both sidecars", got)
	}
	if got := holds(t, path, "state/new-job.db"); len(got) != 0 {
		t.Errorf("the old name still holds %v", got)
	}
	if got := fileJobs(t, path)[0]["state"]; got != target {
		t.Errorf("the file says %v, want %s", got, target)
	}
	if again := next.StateByID(quiet); again.Jobs[0].State != next.Jobs[0].State {
		t.Errorf("a second start moved the record again, to %s", again.Jobs[0].State)
	}
}

func TestTheMoveIsSkippedWhenTheIDsNameIsTaken(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"`+photosID+`","name":"photos","left":"/a","right":"/b","state":"state/photos.db"}]}`)
	withDatabase(t, path, "state/photos.db")
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), "state", photosID+".db-wal"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}

	next := cfg.StateByID(quiet)

	if got := holds(t, path, "state/photos.db"); len(got) != 3 || next.Jobs[0].State != cfg.Jobs[0].State {
		t.Errorf("the job moved to %s and left %v behind, want it left where it was", next.Jobs[0].State, got)
	}
}

func TestTwoJobsSharingADatabaseAreLeftAlone(t *testing.T) {
	path := writeConfig(t, `{"jobs":[
		{"id":"`+photosID+`","name":"photos","left":"/a","right":"/b","state":"state/shared.db"},
		{"id":"bbbbbbbbbbbb","name":"music","left":"/c","right":"/d","state":"state/shared.db"}]}`)
	withDatabase(t, path, "state/shared.db")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}

	next := cfg.StateByID(quiet)

	for i, j := range next.Jobs {
		if j.State != cfg.Jobs[i].State {
			t.Errorf("%s moved to %s, want both jobs left on the file they share", j.Name, j.State)
		}
	}
	if got := holds(t, path, "state/shared.db"); len(got) != 3 {
		t.Errorf("the shared file holds %v, want all of it still there", got)
	}
}

func TestAMoveThatCannotBeSavedLeavesTheJobOnItsOldFile(t *testing.T) {
	path := writeConfig(t, `{"jobs":[{"id":"`+photosID+`","name":"photos","left":"/a","right":"/b","state":"state/photos.db"}]}`)
	withDatabase(t, path, "state/photos.db")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	// save writes the new file beside the old one first, and a folder in its
	// way stops it.
	if err := os.Mkdir(path+".checking", 0o755); err != nil {
		t.Fatal(err)
	}
	var said []string
	log := func(format string, args ...any) { said = append(said, format) }

	next := cfg.StateByID(log)

	if next.Jobs[0].State != cfg.Jobs[0].State {
		t.Errorf("the job reads %s, want its old file", next.Jobs[0].State)
	}
	if got := holds(t, path, "state/photos.db"); len(got) != 3 {
		t.Errorf("the old name holds %v, want the database put back with its sidecars", got)
	}
	if got := fileJobs(t, path)[0]["state"]; got != "state/photos.db" {
		t.Errorf("the file says %v, want the old path", got)
	}
	if len(said) != 1 {
		t.Errorf("the log got %d lines, want one", len(said))
	}
}

func TestADatabaseMovesWholeOrNotAtAll(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, "photos.db"), filepath.Join(dir, photosID+".db")
	for _, s := range sidecars {
		if err := os.WriteFile(from+s, []byte("record"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A folder where the log would go refuses it.
	if err := os.MkdirAll(filepath.Join(to+"-wal", "inside"), 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := moveDatabase(from, to); err == nil {
		t.Fatal("the move reported success with its log refused")
	}
	for _, s := range sidecars {
		if _, err := os.Stat(from + s); err != nil {
			t.Errorf("photos.db%s is not where it was: %v", s, err)
		}
	}
	if _, err := os.Stat(to); err == nil {
		t.Error("the database stayed at the new name without its log")
	}
}
