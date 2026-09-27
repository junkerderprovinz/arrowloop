package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/apply"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// conflictView is one open conflict as the screen shows it.
type conflictView struct {
	Job string `json:"job"`
	// Copy names the conflict when deciding it: the set-aside version's path.
	Copy  string `json:"copy"`
	Plain string `json:"plain"`
	// Side is the side the set-aside version came from.
	Side string `json:"side"`
	// At is when the run that kept both versions began.
	At    string   `json:"at"`
	Left  sideView `json:"left"`
	Right sideView `json:"right"`
}

type unreadView struct {
	Job   string `json:"job"`
	Error string `json:"error"`
}

func versionView(v apply.Version) sideView {
	return sideView{Path: v.Path, Size: v.Size, Mod: v.Mod.UTC().Format(time.RFC3339)}
}

// listConflicts answers with every open conflict, or those of the one job asked
// for, and the jobs that could not be read.
func (s *Server) listConflicts(w http.ResponseWriter, r *http.Request) {
	found, unread := s.Runner.Conflicts(r.Context(), r.URL.Query().Get("job"))
	out := struct {
		Conflicts []conflictView `json:"conflicts"`
		Unread    []unreadView   `json:"unread"`
	}{Conflicts: make([]conflictView, 0, len(found)), Unread: make([]unreadView, 0, len(unread))}
	for _, c := range found {
		out.Conflicts = append(out.Conflicts, conflictView{
			Job: c.Job, Copy: c.Copy, Plain: c.Plain, Side: c.Side.String(),
			At:   c.At.UTC().Format(time.RFC3339),
			Left: versionView(c.Left), Right: versionView(c.Right),
		})
	}
	for _, u := range unread {
		out.Unread = append(out.Unread, unreadView{Job: u.Job, Error: u.Err.Error()})
	}
	writeJSON(w, http.StatusOK, out)
}

// decideConflicts carries out the choices made on one job's conflicts and
// answers once they are done, with the run that did it. The work runs on a
// context of its own, so leaving the page does not stop it halfway.
func (s *Server) decideConflicts(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Decisions []struct {
			Copy string `json:"copy"`
			Keep string `json:"keep"`
		} `json:"decisions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	name := r.PathValue("name")
	if _, ok := s.Runner.Config().Find(name); !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	decisions := make([]apply.Decision, 0, len(body.Decisions))
	for _, d := range body.Decisions {
		decisions = append(decisions, apply.Decision{Copy: d.Copy, Keep: plan.ParseResolution(d.Keep)})
	}
	if len(decisions) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("nothing was decided"))
		return
	}

	run, err := s.Runner.Decide(context.WithoutCancel(r.Context()), name, decisions)
	switch {
	case errors.Is(err, daemon.ErrAlreadyRunning):
		writeError(w, http.StatusConflict, err)
	case errors.Is(err, daemon.ErrOneWay):
		writeError(w, http.StatusBadRequest, err)
	case err != nil && run.Started.IsZero():
		writeError(w, http.StatusBadGateway, err)
	default:
		// A run that went wrong halfway is still a run, and its record says
		// what it managed.
		writeJSON(w, http.StatusOK, map[string]any{"job": name, "run": run})
	}
}
