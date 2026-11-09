package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/junkerderprovinz/parleyport/kit/status"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/fortress"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
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
