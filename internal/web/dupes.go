package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/dupes"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// findDuplicates reports files on one side whose content is identical. It
// works per side, since the two sides of a job are meant to hold the same
// files. The job's exclude patterns apply, so an excluded file is never offered
// for deletion.
func (s *Server) findDuplicates(w http.ResponseWriter, r *http.Request) {
	name, side := r.PathValue("name"), r.PathValue("side")
	j, ok := s.Runner.Config().Find(name)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	settings, err := j.Options()
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	f, code, err := s.sideOf(r.Context(), name, side)
	if err != nil {
		writeError(w, code, err)
		return
	}

	// An unreadable limit is refused, as in verifyJob.
	limit := 200
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("limit %q is not a number", raw))
			return
		}
		limit = n
	}

	// The request's context, so navigating away stops the walk.
	report, err := dupes.Find(r.Context(), f, scan.Options{Exclude: settings.Exclude}, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"job":        name,
		"side":       side,
		"groups":     report.Groups,
		"wasted":     report.Wasted,
		"scanned":    report.Scanned,
		"unhashable": report.Unhashable,
	})
}
