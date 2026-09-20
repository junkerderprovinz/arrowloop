package web

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// The phone decides whether its state should hold scheduled runs and sends the
// verdict with a sentence for the log, rather than raw flags this layer would
// have to interpret.

// readDevice says what was last reported, and whether it is still believed: a
// killed reporter's hold expires, and a client can say the app has not
// reported for a while.
func (s *Server) readDevice(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Hold.State())
}

// writeDevice records a report. An empty reason clears the hold.
func (s *Server) writeDevice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	s.Hold.Report(body.Reason)
	writeJSON(w, http.StatusOK, s.Hold.State())
}

// runDue runs every job whose schedule has come round since it last succeeded.
// Unlike the other run routes it blocks until they are done, because the caller
// is Android holding a wake lock until the copying has finished. The summary
// lets the phone's notification tell success from failure.
func (s *Server) runDue(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Runner.RunDue(r.Context()))
}
