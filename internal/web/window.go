package web

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// The window settings exist only where there is a window.
//
// The command line binary and the container leave Server.Window nil, the two
// routes are then never registered, and the interface asks once and hides the
// card when nothing answers. That is better than serving a card that is
// present and inert: a setting that cannot do anything is worse than a setting
// that is not offered, because somebody will change it and expect something.

// capabilities says what this build can do, and every build answers it.
//
// The interface used to find out by asking for the window settings and reading
// the 404, which worked and put a red line in the browser's console on every
// load of a container build. A refusal that is expected is not an error, and a
// console full of expected errors is a console nobody reads when a real one
// appears.
func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"window": s.Window != nil,
		// Read from the build rather than typed anywhere on the page: a number
		// written down twice is a number that disagrees with itself the day one
		// of them is bumped.
		"version": boot.Version,
	})
}

func (s *Server) readWindow(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Window.Get())
}

func (s *Server) writeWindow(w http.ResponseWriter, r *http.Request) {
	var next deskset.Settings
	if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	if err := s.Window.Set(next); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// Answered from the store rather than from the request, because the store
	// clears what it cannot honour: with no icon in the notification area there
	// is nowhere for either button to send the window.
	writeJSON(w, http.StatusOK, s.Window.Get())
}
