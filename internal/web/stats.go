package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// historyStats answers the History tab's chart: one row per day over a window,
// optionally split per job, plus the totals. Every rule lives in
// history.Summary.
func (s *Server) historyStats(w http.ResponseWriter, r *http.Request) {
	asked := r.URL.Query().Get("job")
	q := history.StatsQuery{Job: s.historyKey(r.Context(), asked)}

	// A value that cannot be parsed is refused rather than replaced by the
	// default, which would draw a month for "days=3O". A window that is too
	// wide is cut down by the summary, which reports the window it used.
	if raw := r.URL.Query().Get("days"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("not a number of days: %s", raw))
			return
		}
		q.Days = n
	}
	if raw := r.URL.Query().Get("byJob"); raw != "" {
		split, err := strconv.ParseBool(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("not a yes or no for byJob: %s", raw))
			return
		}
		q.ByJob = split
	}

	out, err := s.History.Summary(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// The answer echoes the question as the page put it, so a page racing two
	// requests can tell them apart.
	if asked != "" {
		out.Job = asked
		for i := range out.Rows {
			out.Rows[i].Job = asked
		}
	}
	writeJSON(w, http.StatusOK, out)
}
