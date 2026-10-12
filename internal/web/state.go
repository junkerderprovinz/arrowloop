package web

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"

	jobpkg "github.com/junkerderprovinz/arrowloop/internal/job"
)

// forgetJobState deletes a job's own state database, for a job being deleted
// for good; removing a job leaves it so the same pair can be set up again.
// The path comes from the job's configuration, never from the caller, so this
// has to be called while the job still exists.
func (s *Server) forgetJobState(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	job, ok := s.Runner.Config().Find(name)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job named %q", name))
		return
	}
	if job.State == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("job %q has no state database", name))
		return
	}

	// Two jobs can keep their record in one file, under the same name or
	// another spelling of it, and deleting it would cost the other job too.
	for _, other := range s.Runner.Config().Jobs {
		if other.Name == name || other.State == "" || jobpkg.Apart(other.State, job.State) {
			continue
		}
		if other.State == job.State || jobpkg.SamePlace(other.State, job.State) {
			writeError(w, http.StatusConflict, fmt.Errorf("job %q keeps its record in the same file, so it stays", other.Name))
		} else {
			writeError(w, http.StatusConflict, fmt.Errorf("the record of job %q cannot be checked, and it may be this same file, so it stays", other.Name))
		}
		return
	}

	// A leftover -wal could be opened against the next database created under
	// the same name.
	removed := 0
	for _, p := range []string{job.State, job.State + "-wal", job.State + "-shm"} {
		err := os.Remove(p)
		switch {
		case err == nil:
			removed++
		case errors.Is(err, fs.ErrNotExist):
			// Already gone is the state the caller asked for.
		default:
			writeError(w, http.StatusInternalServerError, fmt.Errorf("remove %s: %w", p, err))
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}
