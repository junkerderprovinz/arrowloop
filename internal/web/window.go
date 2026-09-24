package web

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/autostart"
	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
)

// capabilities says what this build can do, so the interface can leave out
// what does not apply instead of probing routes and reading a 404.
func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		// Only the desktop shell has window settings.
		"window": s.Window != nil,
		// Whether the device can report that now is a bad moment, as a phone
		// on battery can.
		"device": s.Hold != nil,
		// Whether the interface can set a password, a second factor and
		// passkeys here. The desktop window cannot, since nobody else reaches it.
		"security": s.Security != nil,
		"version":  boot.Version,
	})
}

// windowView is the window settings plus StartWithSystem, which is read from
// the operating system on every request rather than kept in window.json, so it
// cannot disagree with an entry removed elsewhere.
type windowView struct {
	deskset.Settings
	StartWithSystem bool `json:"startWithSystem"`

	// CanStartWithSystem says whether this system has an autostart mechanism
	// at all.
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

	// The autostart entry goes first, since it can fail on something outside
	// this program, and a failure then leaves everything unchanged.
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

	// Answered from the store and the system rather than the request, since
	// both correct what they cannot honour.
	v, err := s.view()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}
