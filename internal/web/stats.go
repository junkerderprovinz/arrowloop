package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// historyStats answers the History tab's chart: one row per day over a window,
// optionally split per job, plus the totals that go beside it.
//
// Register as: mux.HandleFunc("GET /api/history/stats", s.historyStats)
//
// Deliberately thin, in the same way the rest of this API is. Everything that
// could be got wrong lives in history.Summary: the zone the days are cut in, the
// bound on the window, the empty days that have to be present rather than
// missing, and the empty list that must not be null. Doing any of it here would
// put it where the tests for the run log cannot reach it, and a rule enforced at
// the edge is a rule the next caller does not get.
func (s *Server) historyStats(w http.ResponseWriter, r *http.Request) {
	q := history.StatsQuery{Job: r.URL.Query().Get("job")}

	// A value that cannot be parsed is refused rather than ignored. The
	// alternative is a handler that has decided to guess: "days=3O" with a
	// letter O reads as a typo to a person and as nothing at all to Atoi, and
	// quietly answering with a month when somebody asked for three days puts a
	// wrong chart on the screen with no sign that anything went astray. A window
	// that is merely too wide is a different matter and is not refused: the
	// summary cuts it down to what it will answer and says so in the reply, so
	// the caller can label the chart with the window it actually got.
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
	writeJSON(w, http.StatusOK, out)
}
