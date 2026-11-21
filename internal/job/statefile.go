package job

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/joblock"
)

// stateFolder is where a job's database goes unless its state path says
// otherwise. Inside it a database is named after the job's id, which a rename
// leaves alone.
const stateFolder = "state"

// sidecars are the files SQLite keeps beside a database in WAL mode. Moved
// without them, the database would lose what is only in its log.
var sidecars = []string{"", "-wal", "-shm"}

// statePathFor is the state path a job with this id is given in the file.
func statePathFor(id string) string {
	return path.Join(stateFolder, id+".db")
}

// nameNewDatabases gives each job in doc that the file on disk does not have
// yet a database named after its settled id, unless its path is somebody's
// choice: outside the state folder, shared, or naming a database that exists.
func (c *Config) nameNewDatabases(doc map[string]any) {
	jobs := docJobs(doc)
	written := map[string]int{}
	for _, j := range jobs {
		written[filepath.Clean(strings.TrimSpace(stateOf(j)))]++
	}
	for _, j := range jobs {
		id := idOf(j)
		if was, ok := c.Find(id); ok && was.ID == id {
			continue
		}
		p := strings.TrimSpace(stateOf(j))
		if p != "" && !c.freshInStateFolder(p, written[filepath.Clean(p)]) {
			continue
		}
		setState(j, statePathFor(id))
	}
}

// freshInStateFolder reports whether p, a state path as the file writes it and
// held by this many jobs, names a database in the state folder that is not
// there yet and that no other job points at.
func (c *Config) freshInStateFolder(p string, holders int) bool {
	if holders > 1 || !filepath.IsLocal(p) || filepath.Dir(filepath.Clean(p)) != stateFolder {
		return false
	}
	_, err := os.Lstat(c.resolve(p))
	return errors.Is(err, fs.ErrNotExist)
}

// StateByID moves each database in the state folder that is not yet named
// after its job's id to that name, with its sidecars, before any run opens
// one, and returns the configuration that points at the moved files. A job
// whose database is shared, in use or cannot be moved keeps the old one.
func (c *Config) StateByID(log func(format string, args ...any)) *Config {
	folder := filepath.Join(c.dir, stateFolder)
	moved := map[string]string{}
	var undo []func()
	for _, j := range c.Jobs {
		to := filepath.Join(folder, j.ID+".db")
		if filepath.Dir(j.State) != folder || j.State == to || c.shared(j, to) || taken(to) {
			continue
		}
		// Another process running the job has the database open.
		release, held, err := joblock.Take(folder, j.Key())
		if held || err != nil {
			continue
		}
		defer release()
		back, err := moveDatabase(j.State, to)
		if err != nil {
			log("%s keeps its record in %s: %v", j.Name, j.State, err)
			continue
		}
		moved[j.ID] = statePathFor(j.ID)
		undo = append(undo, back)
	}
	if len(moved) == 0 {
		return c
	}
	next, err := c.save(func(doc map[string]any) {
		for _, j := range docJobs(doc) {
			if p, ok := moved[c.idIn(j)]; ok {
				setState(j, p)
			}
		}
	})
	if err != nil {
		for _, back := range undo {
			back()
		}
		log("the records stay under the job names, since the configuration cannot be written: %v", err)
		return c
	}
	return next
}

// shared reports whether another job keeps its record in j's database or in
// the one j would move to.
func (c *Config) shared(j Job, to string) bool {
	for _, other := range c.Jobs {
		if other.ID == j.ID {
			continue
		}
		if other.State == j.State || other.State == to || SamePlace(other.State, j.State) {
			return true
		}
	}
	return false
}

// taken reports whether anything of a database is at p, or whether that
// cannot be told.
func taken(p string) bool {
	for _, s := range sidecars {
		if _, err := os.Lstat(p + s); !errors.Is(err, fs.ErrNotExist) {
			return true
		}
	}
	return false
}

// moveDatabase renames the database at from and its sidecars to to. Either
// all of them move or none, and undo puts them back.
func moveDatabase(from, to string) (undo func(), err error) {
	var done []string
	undo = func() {
		for _, s := range done {
			_ = os.Rename(to+s, from+s)
		}
	}
	for _, s := range sidecars {
		if _, err := os.Lstat(from + s); errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err := os.Rename(from+s, to+s); err != nil {
			undo()
			return nil, fmt.Errorf("move it to %s: %w", to, err)
		}
		done = append(done, s)
	}
	return undo, nil
}

// stateOf reads a job's state path in whatever case its key is spelt.
func stateOf(j map[string]any) string {
	for k, v := range j {
		if s, ok := v.(string); ok && strings.EqualFold(k, "state") {
			return s
		}
	}
	return ""
}

// setState writes p under the one spelling of the key.
func setState(j map[string]any, p string) {
	for k := range j {
		if strings.EqualFold(k, "state") {
			delete(j, k)
		}
	}
	j["state"] = p
}
