package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode"
)

// createJob adds one job, for a program that hands a pair of folders over,
// such as a file manager offering to keep two folders in step. The job goes
// through the same validation as one saved in the editor, and a name that is
// taken is refused rather than replaced, because a caller that does not know
// the job list cannot know what it would overwrite.
func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	var j map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&j); err != nil || j == nil {
		writeError(w, http.StatusBadRequest, errors.New("send the job as a JSON object"))
		return
	}
	name, _ := j["name"].(string)
	name = strings.TrimSpace(name)
	if err := checkJobName(name); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	j["name"] = name
	if state, _ := j["state"].(string); strings.TrimSpace(state) == "" {
		j["state"] = "state/" + name + ".db"
	}

	s.saving.Lock()
	defer s.saving.Unlock()
	current := s.Runner.Config()
	if _, taken := current.Find(name); taken {
		writeError(w, http.StatusConflict, fmt.Errorf("there is a job called %q already", name))
		return
	}
	next, err := current.AddJobs(j)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Runner.Reload(next)

	jobs, err := next.JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	for _, stored := range jobs {
		if stored["name"] == name {
			writeJSON(w, http.StatusCreated, stored)
			return
		}
	}
	writeError(w, http.StatusInternalServerError, errors.New("the job was saved but cannot be read back"))
}

// checkJobName refuses names that cannot stand in the state database's file
// name, which createJob makes from the name when the caller gives none.
func checkJobName(name string) error {
	switch {
	case name == "":
		return errors.New("the job needs a name")
	case len(name) > 200:
		return errors.New("the job name is longer than 200 characters")
	case name == "." || name == "..", strings.ContainsAny(name, `/\`):
		return fmt.Errorf("the job name %q cannot contain a slash or be a dot", name)
	case strings.IndexFunc(name, unicode.IsControl) >= 0:
		return errors.New("the job name contains a control character")
	}
	return nil
}
