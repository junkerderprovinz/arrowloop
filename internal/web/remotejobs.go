package web

// A job of this instance opened and saved from another instance of the group.
// The owner keeps the last word: a save from the group meets the same
// validation as one made here, may name a target only by the name it has
// here, keeps the state database and the commands where the owner put them,
// and is logged with the member that sent it. The targets themselves, the
// settings, the trash and the phrase are not reachable from the group at all.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/rclone/rclone/fs/fspath"

	"github.com/junkerderprovinz/arrowloop/internal/federation"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// openedJob is one job as another member edits it: the entry as the file has
// it, without its commands, and the defaults it falls back on here, so the
// form shows what the job runs with.
type openedJob struct {
	Job      map[string]any `json:"job"`
	Defaults job.Defaults   `json:"defaults"`
}

// placesView is what a side on this instance can name, for the folder picker
// of another member: the targets by name, the marked drives and the names of
// the exclude sets. No target's settings travel, its secrets least of all.
type placesView struct {
	Targets     []placeTarget `json:"targets"`
	Drives      []placeDrive  `json:"drives"`
	ExcludeSets []string      `json:"excludeSets"`
}

type placeTarget struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Provider string `json:"provider,omitempty"`
	Mark     string `json:"mark,omitempty"`
}

type placeDrive struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Path     string `json:"path"`
	Attached bool   `json:"attached"`
}

func (s *Server) groupReadJob(w http.ResponseWriter, r *http.Request) {
	cfg := s.Runner.Config()
	jobs, err := cfg.JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	at := jobAt(jobs, r.PathValue("name"))
	if at < 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", r.PathValue("name")))
		return
	}
	writeJSON(w, http.StatusOK, openedJob{Job: withoutCommands(jobs[at]), Defaults: cfg.Defaults})
}

func (s *Server) groupSaveJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	who := s.callerName(r)
	var entry map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&entry); err != nil || entry == nil {
		writeError(w, http.StatusBadRequest, errors.New("send the job as a JSON object"))
		return
	}

	s.saving.Lock()
	defer s.saving.Unlock()
	cfg := s.Runner.Config()
	jobs, err := cfg.JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	at := jobAt(jobs, name)
	if at < 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	saved, err := fitForOwner(entry, jobs[at])
	if err == nil {
		jobs[at] = entry
		var next *job.Config
		if next, err = cfg.SaveJobs(jobs); err == nil {
			s.Runner.Reload(next)
			cfg = next
		}
	}
	if err != nil {
		s.logf("pairing: refused the change %s sent for the job %q: %v", who, name, err)
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if saved == name {
		s.logf("pairing: %s saved the job %q here", who, name)
	} else {
		s.logf("pairing: %s saved the job %q here under the new name %q", who, name, saved)
	}

	jobs, err = cfg.JobsAsMaps()
	if at = jobAt(jobs, saved); err != nil || at < 0 {
		writeError(w, http.StatusInternalServerError, errors.New("the job was saved but cannot be read back"))
		return
	}
	writeJSON(w, http.StatusOK, openedJob{Job: withoutCommands(jobs[at]), Defaults: cfg.Defaults})
}

func (s *Server) groupPlaces(w http.ResponseWriter, _ *http.Request) {
	out := placesView{Targets: []placeTarget{}, Drives: []placeDrive{}, ExcludeSets: []string{}}
	for _, t := range remotes.List() {
		out.Targets = append(out.Targets, placeTarget{Name: t.Name, Type: t.Type, Provider: t.Provider, Mark: t.Mark})
	}
	for _, d := range volume.Remembered() {
		out.Drives = append(out.Drives, placeDrive{ID: d.ID, Label: d.Label, Path: volume.Prefix + d.ID, Attached: d.Attached})
	}
	for set := range s.Runner.Config().ExcludeSets {
		out.ExcludeSets = append(out.ExcludeSets, set)
	}
	sort.Strings(out.ExcludeSets)
	writeJSON(w, http.StatusOK, out)
}

// callerName names the member a call from the group came from in this
// instance's log: by the name it announces and by its id, which no other
// member can take.
func (s *Server) callerName(r *http.Request) string {
	c, ok := federation.CallerOf(r.Context())
	if !ok {
		return "an unknown instance"
	}
	for _, m := range s.Group.Members() {
		if m.ID == c.ID && m.Name != "" {
			return fmt.Sprintf("the instance %s (%s)", m.Name, c.ID)
		}
	}
	return "the instance " + c.ID
}

// jobAt is the place of the job called name in jobs as the file holds them,
// or -1.
func jobAt(jobs []map[string]any, name string) int {
	for i, j := range jobs {
		if j["name"] == name {
			return i
		}
	}
	return -1
}

// withoutCommands is a job without the commands it runs. They run on this
// machine and may carry a token, so another member neither sees nor sets them.
func withoutCommands(entry map[string]any) map[string]any {
	out := make(map[string]any, len(entry))
	for k, v := range entry {
		if !job.IsCommandKey(k) {
			out[k] = v
		}
	}
	return out
}

// fitForOwner makes entry what another member may save over stored, and
// returns the name it saves under. The state database stays where the owner
// keeps it, since a path from the group would have this instance write a
// database wherever it says. Keys are compared in any case, as Load reads them.
func fitForOwner(entry, stored map[string]any) (string, error) {
	for key := range entry {
		if job.IsCommandKey(key) || strings.EqualFold(key, "state") {
			delete(entry, key)
		}
	}
	for key, v := range stored {
		if strings.EqualFold(key, "state") {
			entry[key] = v
		}
	}
	name, _ := entry["name"].(string)
	name = strings.TrimSpace(name)
	if err := checkJobName(name); err != nil {
		return "", err
	}
	entry["name"] = name
	targets := map[string]bool{}
	for _, t := range remotes.List() {
		targets[t.Name] = true
	}
	for key, v := range entry {
		if !strings.EqualFold(key, "left") && !strings.EqualFold(key, "right") {
			continue
		}
		side, _ := v.(string)
		if err := ownerSide(side, targets); err != nil {
			return "", err
		}
	}
	return name, nil
}

// ownerSide refuses a side that reaches a target other than one of targets by
// its plain name. A connection string, or a target's settings overridden in
// the side, would let the group point this instance's credentials or its
// connections anywhere.
func ownerSide(side string, targets map[string]bool) error {
	side = strings.TrimSpace(side)
	if side == "" || strings.HasPrefix(side, volume.Prefix) {
		return nil
	}
	parsed, err := fspath.Parse(side)
	if err != nil {
		return fmt.Errorf("the side %q does not read as a folder or a target: %w", side, err)
	}
	if parsed.Name == "" {
		return nil
	}
	if parsed.Config != nil || !targets[parsed.Name] {
		return fmt.Errorf("the side %q names no target this instance has; from another instance a side names a target here by its name alone", side)
	}
	return nil
}

// instanceJobConfig opens or saves a job of another instance of the group.
func (s *Server) instanceJobConfig(w http.ResponseWriter, r *http.Request) {
	s.toInstance(w, r, "/api/jobs/"+url.PathEscape(r.PathValue("name"))+"/config")
}

// instancePlaces lists what a side on another instance can name.
func (s *Server) instancePlaces(w http.ResponseWriter, r *http.Request) {
	s.toInstance(w, r, "/api/places")
}

// instanceBrowse lists the folders in one folder of another instance.
func (s *Server) instanceBrowse(w http.ResponseWriter, r *http.Request) {
	s.toInstance(w, r, "/api/browse?path="+url.QueryEscape(r.URL.Query().Get("path")))
}

// toInstance passes the call on to the instance of the group the address
// names, as path there, and hands its answer back as it came.
func (s *Server) toInstance(w http.ResponseWriter, r *http.Request, path string) {
	var body []byte
	if r.Method != http.MethodGet {
		read, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
			return
		}
		body = read
	}
	ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
	defer cancel()
	out, status, err := s.Group.Proxy(ctx, r.PathValue("id"), r.Method, path, body)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(err, federation.ErrUnknownInstance) {
			code = http.StatusNotFound
		}
		writeError(w, code, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(out)
}
