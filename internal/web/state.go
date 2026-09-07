package web

import (
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
)

// forgetJobState deletes a job's own state database.
//
// The state database is what lets a run tell "created over here" apart from
// "deleted over there": it records what both sides looked like the last time
// they agreed. Removing a job leaves it behind on purpose, so the same pair can
// be set up again without every file being treated as new. But a job somebody
// is deleting for good leaves a database nothing will ever open again, and
// there was no way to be rid of it except finding the file by hand.
//
// The NAME comes in, never the path. The path is resolved from the job's own
// entry in the configuration, which is why this has to be called while the job
// is still in it: a caller cannot name a file, so a caller cannot name a file
// outside the configuration. That is the whole reason this is a route of its
// own rather than a flag on the config write.
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

	// SQLite writes two siblings beside the database and both outlive it. A
	// leftover -wal is not merely untidy: the next database created under the
	// same name can be opened against somebody else's write-ahead log.
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
