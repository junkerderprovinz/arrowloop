package web

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/autostart"
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

// windowView is the window settings plus the one that is not stored here.
//
// StartWithSystem lives in the operating system, not in window.json, and this
// endpoint reads it back from there on every request. Keeping a copy in the
// file would give one setting two sources of truth, and the copy would go on
// claiming autostart was on after somebody removed the entry with the Task
// Manager's own startup tab. A toggle that disagrees with the thing it controls
// is worse than no toggle.
type windowView struct {
	deskset.Settings
	StartWithSystem bool `json:"startWithSystem"`

	// Whether this system has an autostart mechanism at all, so the interface
	// can leave the switch out instead of drawing one that cannot act.
	CanStartWithSystem bool `json:"canStartWithSystem"`
}

func (s *Server) view() (windowView, error) {
	on, err := autostart.Enabled()
	if err != nil {
		return windowView{}, fmt.Errorf("read the autostart entry: %w", err)
	}
	return windowView{
		Settings:           s.Window.Get(),
		StartWithSystem:    on,
		CanStartWithSystem: autostart.Supported(),
	}, nil
}

func (s *Server) readWindow(w http.ResponseWriter, r *http.Request) {
	v, err := s.view()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) writeWindow(w http.ResponseWriter, r *http.Request) {
	var next windowView
	if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}

	// The autostart entry goes first, because it is the half that can fail on
	// something outside this program: a locked registry, a read-only home. Doing
	// it first means a failure leaves EVERYTHING unchanged, instead of leaving
	// the file written and the system not, which is the state that makes the
	// next read look like the setting silently reverted itself.
	if autostart.Supported() {
		was, err := autostart.Enabled()
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Errorf("read the autostart entry: %w", err))
			return
		}
		if was != next.StartWithSystem {
			if err := autostart.Set(next.StartWithSystem); err != nil {
				writeError(w, http.StatusInternalServerError, fmt.Errorf("change the autostart entry: %w", err))
				return
			}
		}
	}

	if err := s.Window.Set(next.Settings); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	// Answered from the store and the system rather than from the request,
	// because both correct what they cannot honour: with no icon in the
	// notification area there is nowhere for either button to send the window,
	// and a system with no autostart mechanism answers false however it was
	// asked.
	v, err := s.view()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}
