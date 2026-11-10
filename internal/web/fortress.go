package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	kitfortress "github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/status"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/fortress"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
)

// readTokenOpens lets a request with a read token through to the status and
// the log, password or not, since a dashboard polling them has no session and
// must not get one.
func (s *Server) readTokenOpens(r *http.Request) error {
	plain, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || s.Security == nil {
		return status.ErrUnauthenticated
	}
	if _, ok := s.Security.MatchReadToken(strings.TrimSpace(plain)); !ok {
		return status.ErrUnauthenticated
	}
	return nil
}

type fortressSource struct{ s *Server }

func (f fortressSource) Report(ctx context.Context, lang string) (status.Report, error) {
	s := f.s
	open, _ := s.Runner.Findings(ctx)
	snap := fortress.Snapshot{
		App:      status.App{ID: "arrowloop", Name: "ArrowLoop", Version: boot.Version},
		Instance: status.Instance{ID: s.instanceID(), Name: s.ownName()},
		Jobs:     s.Runner.Config().Jobs,
		Findings: open,
		Working:  s.Runner.Working(),
		Now:      time.Now(),
	}
	if s.History != nil {
		latest, err := s.History.Latest(ctx, time.Time{})
		if err != nil {
			return status.Report{}, err
		}
		for _, l := range latest {
			snap.Latest = append(snap.Latest, l.Run)
		}
	}
	return fortress.Report(snap, lang), nil
}

func (f fortressSource) Log(ctx context.Context, q status.LogQuery) (status.LogPage, error) {
	var runs []history.Run
	if f.s.History != nil {
		// A cursor this engine never handed out starts at the beginning.
		after, _ := strconv.ParseInt(q.After, 10, 64)
		var err error
		if runs, err = f.s.History.After(ctx, after, q.Limit); err != nil {
			return status.LogPage{}, err
		}
	}
	return fortress.Log(runs, q.After, q.Lang), nil
}

// FortressActions are what this engine does for the other apps of a fortress
// it joins: list its jobs and start one.
func (s *Server) FortressActions() []kitfortress.Action {
	return []kitfortress.Action{
		{Name: "jobs.list", Run: s.fortressJobs},
		{Name: "jobs.run", Run: s.fortressRun},
	}
}

// FortressExport hands this engine's backup to an app of the fortress that
// keeps backups, for fortress.Config.Export.
func (s *Server) FortressExport(ctx context.Context, from kitfortress.Caller) (io.ReadCloser, int64, error) {
	return s.Runner.Export(ctx, from.App+" on "+from.Device)
}

// fortressJob is a job as another app sees it. The sides stay out: a side
// can carry a remote's settings, and the other app asks for a job by name.
type fortressJob struct {
	Name      string   `json:"name"`
	Direction string   `json:"direction"`
	Mode      string   `json:"mode"`
	Paused    bool     `json:"paused"`
	Running   bool     `json:"running"`
	LastRun   *lastRun `json:"lastRun,omitempty"`
}

type lastRun struct {
	At time.Time `json:"at"`
	// Outcome is one of fortress.Outcome's names.
	Outcome string `json:"outcome"`
}

func (s *Server) fortressJobs(ctx context.Context, _ kitfortress.Caller, _ []byte) ([]byte, error) {
	latest := map[string]history.Run{}
	if s.History != nil {
		runs, err := s.History.Latest(ctx, time.Time{})
		if err != nil {
			return nil, err
		}
		for _, l := range runs {
			latest[l.Run.Job] = l.Run
		}
	}
	running := s.Runner.Running()
	out := []fortressJob{}
	for _, j := range s.Runner.Config().Jobs {
		v := fortressJob{
			Name:      j.Name,
			Direction: directionName(plan.ParseDirection(j.Direction)),
			Mode:      plan.ParseMode(j.Mode).String(),
			Paused:    j.Disabled,
			Running:   running[j.Name],
		}
		if run, ok := latest[j.Name]; ok {
			v.LastRun = &lastRun{At: run.Finished.UTC(), Outcome: fortress.Outcome(run)}
		}
		out = append(out, v)
	}
	return json.Marshal(out)
}

func (s *Server) fortressRun(_ context.Context, from kitfortress.Caller, body []byte) ([]byte, error) {
	var req struct {
		Job string `json:"job"`
	}
	if json.Unmarshal(body, &req) != nil {
		return nil, &kitfortress.Refusal{Code: "bad_request"}
	}
	queued, err := s.Runner.Request(req.Job, from.App+" on "+from.Device)
	switch {
	case errors.Is(err, daemon.ErrNoSuchJob):
		return nil, &kitfortress.Refusal{Code: "no_such_job"}
	case errors.Is(err, daemon.ErrPaused):
		return nil, &kitfortress.Refusal{Code: "job_paused"}
	case err != nil:
		return nil, err
	}
	state := "started"
	if queued {
		state = "queued"
	}
	return json.Marshal(map[string]string{"job": req.Job, "status": state})
}

// instanceID names this install for as long as its key lasts. It is derived
// from the key rather than the member key, which a new pairing replaces.
func (s *Server) instanceID() string {
	mac := hmac.New(sha256.New, s.key())
	mac.Write([]byte("arrowloop/fortress/instance-id/v1"))
	return hex.EncodeToString(mac.Sum(nil)[:16])
}

// ownName is the name the other instances see, or the app's where the
// machine has none.
func (s *Server) ownName() string {
	var st pairing.State
	if s.Pairing != nil {
		st = s.Pairing.Get()
	}
	if name := s.instanceName(st); name != "" {
		return name
	}
	return "ArrowLoop"
}

// readTokenView is a token as the settings list it, without its hash.
type readTokenView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Server) listReadTokens(w http.ResponseWriter, _ *http.Request) {
	out := []readTokenView{}
	for _, t := range s.Security.Get().ReadTokens {
		out = append(out, readTokenView{ID: t.ID, Name: t.Name, CreatedAt: t.CreatedAt})
	}
	writeJSON(w, http.StatusOK, out)
}

// maxReadTokenName keeps a name to what fits a row of the list.
const maxReadTokenName = 64

func (s *Server) addReadToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !readBody(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > maxReadTokenName {
		writeError(w, http.StatusBadRequest, fmt.Errorf("a read token needs a name of 1 to %d characters", maxReadTokenName))
		return
	}
	plain, t, err := s.Security.AddReadToken(name, time.Now().Unix())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		readTokenView
		Token string `json:"token"`
	}{readTokenView{ID: t.ID, Name: t.Name, CreatedAt: t.CreatedAt}, plain})
}

func (s *Server) deleteReadToken(w http.ResponseWriter, r *http.Request) {
	if err := s.Security.DeleteReadToken(r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}
