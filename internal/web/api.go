// Package web serves the interface and the small API behind it.
//
// The API is deliberately thin: it exposes what the engine already decides
// rather than deciding anything of its own. The one screen it exists for is the
// preview, where a person reads every proposed change with its direction and
// its reason, unticks the ones they do not want, and only then lets anything
// happen. A two-way sync that acts before somebody has seen the plan is asking
// for trust it has not earned.
package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strconv"
	"time"

	"github.com/junkerderprovinz/reeveroll/internal/daemon"
	"github.com/junkerderprovinz/reeveroll/internal/history"
	"github.com/junkerderprovinz/reeveroll/internal/job"
	"github.com/junkerderprovinz/reeveroll/internal/plan"
)

// Server answers the browser.
type Server struct {
	Config  *job.Config
	History *history.DB
	Runner  *daemon.Runner

	// UI is the built interface. A nil filesystem serves the API only, which is
	// what the tests use and what a headless deployment can live with.
	UI fs.FS
}

// Handler builds the routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/jobs", s.listJobs)
	mux.HandleFunc("GET /api/jobs/{name}/plan", s.previewJob)
	mux.HandleFunc("POST /api/jobs/{name}/run", s.runJob)
	mux.HandleFunc("GET /api/history", s.listHistory)
	mux.HandleFunc("GET /api/events", s.events)

	if s.UI != nil {
		mux.Handle("/", spa{fs: s.UI})
	}
	return mux
}

// jobView is one row of the job list.
type jobView struct {
	Name        string  `json:"name"`
	Left        string  `json:"left"`
	Right       string  `json:"right"`
	Schedule    string  `json:"schedule"`
	Disabled    bool    `json:"disabled"`
	Running     bool    `json:"running"`
	LastSuccess *string `json:"lastSuccess"`
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	running := s.Runner.Running()
	out := make([]jobView, 0, len(s.Config.Jobs))
	for _, j := range s.Config.Jobs {
		v := jobView{
			Name: j.Name, Left: j.Left, Right: j.Right,
			Schedule: j.Schedule, Disabled: j.Disabled, Running: running[j.Name],
		}
		if when, ok, err := s.History.LastSuccess(r.Context(), j.Name); err == nil && ok {
			stamp := when.UTC().Format(time.RFC3339)
			v.LastSuccess = &stamp
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, out)
}

// actionView is one proposed change, in the words the screen shows.
type actionView struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	From   string `json:"from,omitempty"`
	To     string `json:"to,omitempty"`
	Reason string `json:"reason"`
}

type planView struct {
	Actions   []actionView `json:"actions"`
	Dirs      []actionView `json:"dirs"`
	Skipped   []skipView   `json:"skipped"`
	Unchanged int          `json:"unchanged"`
	Agreed    int          `json:"agreed"`
}

type skipView struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

func (s *Server) previewJob(w http.ResponseWriter, r *http.Request) {
	p, err := s.Runner.Preview(r.Context(), r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, viewOf(p))
}

func viewOf(p *plan.Plan) planView {
	out := planView{
		Actions:   make([]actionView, 0, len(p.Actions)),
		Dirs:      make([]actionView, 0, len(p.Dirs)),
		Skipped:   make([]skipView, 0, len(p.Skipped)),
		Unchanged: p.Unchanged,
		Agreed:    len(p.Agreed),
	}
	for _, a := range p.Actions {
		v := actionView{Path: a.Path, Kind: a.Kind.String(), Reason: a.Reason}
		switch a.Kind {
		case plan.Copy:
			v.From, v.To = a.Src.String(), a.Dst.String()
		case plan.Move:
			v.From, v.To = a.OldDstPath, a.DstPath
		case plan.Delete:
			v.To = a.Dst.String()
		}
		out.Actions = append(out.Actions, v)
	}
	for _, d := range p.Dirs {
		if d.Kind == plan.RecordDir || d.DstPath == "" {
			continue
		}
		out.Dirs = append(out.Dirs, actionView{
			Path: d.Path, Kind: d.Kind.String(), To: d.Dst.String(), Reason: d.Reason,
		})
	}
	for _, sk := range p.Skipped {
		out.Skipped = append(out.Skipped, skipView{Path: sk.Path, Reason: sk.Reason})
	}
	return out
}

// runRequest optionally narrows a run to the paths somebody ticked.
//
// An absent "only" means everything. An "only" that is present and empty means
// exactly that: nothing was ticked, so nothing should happen. Those two have to
// stay distinguishable, or unticking every row would silently run the whole
// plan, which is the opposite of what the person just asked for.
type runRequest struct {
	Only *[]string `json:"only"`
}

func (s *Server) runJob(w http.ResponseWriter, r *http.Request) {
	var req runRequest
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
			return
		}
	}

	// A present-but-empty list stays distinguishable from an absent one:
	// encoding/json decodes [] into a non-nil empty slice, so "only": [] gives
	// an empty selection here while a missing field leaves this nil.
	var only []string
	if req.Only != nil {
		only = *req.Only
	}

	// The browser tab is not the run's owner. Somebody navigating away, or a
	// laptop closing its lid, must not cancel a transfer that is already moving
	// files, so the work gets a context of its own.
	name := r.PathValue("name")
	go func() {
		if _, err := s.Runner.RunOnly(context.Background(), name, only); err != nil && !errors.Is(err, daemon.ErrAlreadyRunning) {
			// The failure is already in the run log and on its way to whatever
			// notifier is configured; nothing further to do here.
			_ = err
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"job": name, "status": "started"})
}

func (s *Server) listHistory(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	runs, err := s.History.Recent(r.Context(), r.URL.Query().Get("job"), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if runs == nil {
		runs = []history.Run{}
	}
	writeJSON(w, http.StatusOK, runs)
}

// events streams what the runner is doing, so a screen can show a job going
// from waiting to running without asking again every second.
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("this server cannot stream"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch, stop := s.Runner.Subscribe()
	defer stop()

	// A comment line every twenty seconds. Without it a proxy in the middle
	// closes an idle stream and the screen quietly stops updating, which looks
	// exactly like a job that never ran.
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case ev, open := <-ch:
			if !open {
				return
			}
			payload, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// spa serves the built interface, falling back to index.html for any path the
// bundle does not contain, so a reload on a sub-page does not 404.
type spa struct{ fs fs.FS }

func (s spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	f, err := s.fs.Open(path[1:])
	if err != nil {
		index, iErr := s.fs.Open("index.html")
		if iErr != nil {
			http.NotFound(w, r)
			return
		}
		defer index.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		http.ServeContent(w, r, "index.html", time.Time{}, index.(readSeeker))
		return
	}
	defer f.Close()
	http.ServeContent(w, r, path, time.Time{}, f.(readSeeker))
}

type readSeeker interface {
	Read([]byte) (int, error)
	Seek(int64, int) (int64, error)
}
