package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/dupes"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// findDuplicates reports files on one side whose content is identical.
//
// Per SIDE rather than per job, because that is where the question lives: the
// same photos under three names are one folder's problem, and a job's two sides
// are supposed to hold the same files - reporting every synced pair as a
// duplicate would be reporting the job doing its work.
//
// The job's own exclude patterns apply. A file the job has been told to ignore
// must not turn up in a list somebody is about to delete from, or a rule written
// to protect something becomes the reason it is offered up.
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

	// An unreadable limit is refused rather than quietly replaced, the same way
	// the verify route refuses one: somebody who asked for a different bound and
	// silently got the standard one reads a truncated list believing otherwise.
	limit := 200
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, fmt.Errorf("limit %q is not a number", raw))
			return
		}
		limit = n
	}

	// The request's own context, so navigating away stops a walk that now has
	// nobody to report to. Unlike a run, this moves nothing and has no reason to
	// outlive the tab that asked.
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
