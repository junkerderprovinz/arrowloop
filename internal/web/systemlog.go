package web

import (
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/systemlog"
)

// systemLog lists the newest lines of the system log, a hundred unless the
// query asks for another number.
func (s *Server) systemLog(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		limit = min(n, history.SystemLogKeep)
	}
	lines, err := s.History.SystemLog(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if lines == nil {
		lines = []history.SystemLine{}
	}
	writeJSON(w, http.StatusOK, lines)
}

// trouble logs a line and notes it in the system log as an integration's
// error.
func (s *Server) trouble(format string, args ...any) {
	s.logf(format, args...)
	s.SystemLog.Note(systemlog.Integration, format, args...)
}
