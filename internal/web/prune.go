package web

import "net/http"

// pruneHistory deletes the runs older than the configuration keeps them,
// apart from the ones each job's schedule is read from.
func (s *Server) pruneHistory(w http.ResponseWriter, r *http.Request) {
	n, err := s.Runner.PruneHistory(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": n})
}
