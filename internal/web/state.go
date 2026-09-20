package web

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
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
