package web

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// volumeView is one drive, attached or not.
type volumeView struct {
	ID       string  `json:"id"`
	Label    string  `json:"label"`
	Mount    string  `json:"mount"`
	Attached bool    `json:"attached"`
	LastSeen *string `json:"lastSeen"`
	Path     string  `json:"path"`
}

func (s *Server) listVolumes(w http.ResponseWriter, r *http.Request) {
	known := volume.Remembered()
	out := make([]volumeView, 0, len(known))
	for _, k := range known {
		v := volumeView{
			ID: k.ID, Label: k.Label, Mount: k.Mount, Attached: k.Attached,
			// The string a job stores for this drive.
			Path: volume.Prefix + k.ID,
		}
		if !k.LastSeen.IsZero() {
			seen := k.LastSeen.Format("2006-01-02T15:04:05Z07:00")
			v.LastSeen = &seen
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"volumes": out})
}

// markVolume writes an identity onto a drive so it can be recognised again
// wherever it turns up next.
func (s *Server) markVolume(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mount string `json:"mount"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	if body.Mount == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("say which drive to mark"))
		return
	}

	m, err := volume.Mark(body.Mount, body.Label)
	if err != nil {
		// Marking writes a file, so this is where a read-only drive says so.
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, volumeView{
		ID: m.ID, Label: m.Label, Mount: body.Mount, Attached: true,
		Path: volume.Prefix + m.ID,
	})
}

// forgetVolume forgets that a drive was ever here. The marker on the drive is
// left alone, so plugging it in again brings it back.
func (s *Server) forgetVolume(w http.ResponseWriter, r *http.Request) {
	volume.Forget(r.PathValue("id"))
	writeJSON(w, http.StatusOK, map[string]any{"forgotten": r.PathValue("id")})
}

// volumeCandidates offers the places a drive could be, so somebody can pick
// one rather than type a path.
func (s *Server) volumeCandidates(w http.ResponseWriter, r *http.Request) {
	marked := map[string]bool{}
	for _, v := range volume.Attached() {
		marked[v.Mount] = true
	}
	type candidate struct {
		Mount  string `json:"mount"`
		Marked bool   `json:"marked"`
	}
	all := volume.Candidates()
	out := make([]candidate, 0, len(all))
	for _, mount := range all {
		out = append(out, candidate{Mount: mount, Marked: marked[mount]})
	}
	writeJSON(w, http.StatusOK, map[string]any{"candidates": out})
}

func (s *Server) listRemotes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"remotes":  remotes.List(),
		"backends": remotes.Backends(),
		// Products rather than protocols; see remotes.Provider.
		"providers": remotes.Providers(),
		"unlisted":  remotes.UnlistedBackends(),
	})
}

// saveRemote writes one storage target.
func (s *Server) saveRemote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type     string            `json:"type"`
		Settings map[string]string `json:"settings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	if err := remotes.Save(r.PathValue("name"), body.Type, body.Settings); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"saved": r.PathValue("name")})
}

func (s *Server) deleteRemote(w http.ResponseWriter, r *http.Request) {
	if err := remotes.Delete(r.PathValue("name")); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": r.PathValue("name")})
}

// checkRemote proves the settings work, which saving them does not.
func (s *Server) checkRemote(w http.ResponseWriter, r *http.Request) {
	if err := remotes.Check(r.Context(), r.PathValue("name")); err != nil {
		// 200 with a reason: a credential that does not work answers the
		// question rather than failing the request.
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// tryRemote checks settings that have not been saved, so a form can be tested
// before a credential is kept. It answers like checkRemote.
func (s *Server) tryRemote(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type     string            `json:"type"`
		Settings map[string]string `json:"settings"`
		// Name is the saved target this form edits, if any. The secrets the
		// form left empty are taken from it; see remotes.WithSavedSecrets.
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	if err := remotes.CheckSettings(r.Context(), body.Type, remotes.WithSavedSecrets(body.Name, body.Settings)); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// aboutRemote reports how full a target is. It is its own route rather than a
// field on the listing, which would ask every target over the network whenever
// the page opens.
func (s *Server) aboutRemote(w http.ResponseWriter, r *http.Request) {
	usage, err := remotes.About(r.Context(), r.PathValue("name"))
	if err != nil {
		// The reason tells an unreachable target from one that keeps no
		// total; both are unsupported.
		writeJSON(w, http.StatusOK, map[string]any{"supported": false, "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, usage)
}
