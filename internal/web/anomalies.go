package web

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/anomaly"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
)

// listAnomalies answers with the open findings, loudest first, and the ones
// closed lately.
func (s *Server) listAnomalies(w http.ResponseWriter, r *http.Request) {
	open, closed := s.Runner.Findings(r.Context())
	if open == nil {
		open = []anomaly.Finding{}
	}
	if closed == nil {
		closed = []anomaly.Finding{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"open": open, "closed": closed})
}

// listLearning answers with every job and how far its habits are learned.
func (s *Server) listLearning(w http.ResponseWriter, r *http.Request) {
	learning := s.Runner.Learning(r.Context())
	if learning == nil {
		learning = []daemon.JobLearning{}
	}
	writeJSON(w, http.StatusOK, learning)
}

// answerAnomaly starts the run that answers a held job: letting the refused
// change run, or taking it back. Like any run it gets a context of its own and
// reports through the event stream, where a brake that refuses again shows as
// the finding's new figures.
func (s *Server) answerAnomaly(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	f, ok := s.Runner.Finding(id)
	if !ok || !f.Held {
		writeError(w, http.StatusNotFound, fmt.Errorf("no held job behind %q; it may have been answered already", id))
		return
	}
	answer := s.Runner.Approve
	switch r.PathValue("answer") {
	case "run":
	case "back":
		answer = s.Runner.TakeBack
	default:
		writeError(w, http.StatusNotFound, fmt.Errorf("no such address: %s", r.URL.Path))
		return
	}
	go func() {
		// A failure is in the run log, and a second refusal in the finding.
		_, _ = answer(context.Background(), id)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"job": f.Job, "status": "started"})
}

// acknowledgeAnomaly closes a note somebody has seen.
func (s *Server) acknowledgeAnomaly(w http.ResponseWriter, r *http.Request) {
	err := s.Runner.Acknowledge(r.PathValue("id"))
	switch {
	case errors.Is(err, anomaly.ErrUnknown):
		writeError(w, http.StatusNotFound, err)
	case err != nil:
		writeError(w, http.StatusBadRequest, err)
	default:
		writeJSON(w, http.StatusOK, map[string]bool{"acknowledged": true})
	}
}
