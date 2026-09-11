package web

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// What the machine the engine runs on is doing that a schedule should respect.
//
// Two routes and no logic, because the logic is not here: the phone decides
// whether "on battery" should stop anything, because the phone is where that
// preference is set and where the battery is. The engine is told the verdict
// and a sentence to put in the log.
//
// It is deliberately not a pair of flags. A flag named `charging` would force
// this layer to know which flags mean hold and which do not, and that knowledge
// would then exist in two places and disagree the first time one changed.

// readDevice says what was last reported, and whether it is still believed.
//
// Believed matters: the reporter can be killed, and a hold that never expired
// would stop every scheduled run from then on. A client that can see the
// staleness can say "the app has not reported for a while" instead of showing
// a state that is no longer acted on.
func (s *Server) readDevice(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Hold.State())
}

// writeDevice records a report.
//
// An empty reason clears the hold, and that is the ordinary case rather than a
// special one: the reporter sends its verdict whenever anything changes, and
// most of the time the verdict is that nothing is in the way.
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
//
// It BLOCKS until they are done, which is the opposite of what every other run
// endpoint here does, and deliberately: the caller is Android holding a wake
// lock, and it may only let the phone sleep once the copying has finished. An
// endpoint that answered immediately would have it report success and go back
// to sleep with the transfer half done.
func (s *Server) runDue(w http.ResponseWriter, r *http.Request) {
	// The whole summary rather than a count. The caller is a phone that has to
	// say something afterwards, and "four jobs ran" and "four ran and one
	// failed" are the two answers a notification has to tell apart.
	writeJSON(w, http.StatusOK, s.Runner.RunDue(r.Context()))
}
