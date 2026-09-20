package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/verify"
)

// verifyJob reads both sides fresh and reports where they disagree with the
// record. A wrong state row matches both sides on every run, so no run ever
// reports it. It is a GET because, like the preview, it changes nothing.
func (s *Server) verifyJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	j, ok := s.Runner.Config().Find(name)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}

	// checksums=true reads every file on both sides instead of judging by
	// size and modification time, which on a large job can take longer than
	// the sync. The report says which was done.
	opt := verify.Opts{Checksums: r.URL.Query().Get("checksums") == "true"}

	// An unreadable limit is refused, so nobody reads a truncated list as the
	// one they asked for.
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("limit %q is not a number", raw))
			return
		}
		opt.Limit = n
	}

	// The request's context: navigating away stops a listing nobody is
	// waiting for, unlike a run, which moves files.
	report, err := verify.Check(r.Context(), j, opt)
	if err != nil {
		// The comparison could not be made; an empty 200 would read as a clean
		// bill of health.
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}
