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

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
)

// Server answers the browser.
//
// It deliberately holds no configuration of its own. The runner owns the one
// copy, and an editor that could change one of two pointers would be an editor
// whose result depends on which half of the program somebody asks.
type Server struct {
	History *history.DB
	Runner  *daemon.Runner

	// UI is the built interface. A nil filesystem serves the API only, which is
	// what the tests use and what a headless deployment can live with.
	UI fs.FS

	// Placeholder is the page served when UI carries no index.html, which is
	// what a binary built without the frontend looks like.
	Placeholder []byte
}

// Handler builds the routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/jobs", s.listJobs)
	mux.HandleFunc("GET /api/jobs/{name}/plan", s.previewJob)
	mux.HandleFunc("POST /api/jobs/{name}/run", s.runJob)
	mux.HandleFunc("GET /api/history", s.listHistory)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/config", s.readConfig)
	mux.HandleFunc("PUT /api/config", s.writeConfig)

	mux.HandleFunc("GET /api/volumes", s.listVolumes)
	mux.HandleFunc("GET /api/volumes/candidates", s.volumeCandidates)
	mux.HandleFunc("POST /api/volumes", s.markVolume)
	mux.HandleFunc("DELETE /api/volumes/{id}", s.forgetVolume)

	mux.HandleFunc("GET /api/remotes", s.listRemotes)
	mux.HandleFunc("PUT /api/remotes/{name}", s.saveRemote)
	mux.HandleFunc("DELETE /api/remotes/{name}", s.deleteRemote)
	mux.HandleFunc("POST /api/remotes/{name}/check", s.checkRemote)

	if s.UI != nil {
		mux.Handle("/", spa{fs: s.UI, placeholder: s.Placeholder})
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
	cfg := s.Runner.Config()
	out := make([]jobView, 0, len(cfg.Jobs))
	for _, j := range cfg.Jobs {
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
	Path string `json:"path"`
	Kind string `json:"kind"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`

	// The reason twice over: the code and its values, which the interface
	// translates, and the English sentence, which it falls back to for a code
	// it has never heard of. An untranslated explanation is worth more than a
	// dotted identifier.
	Reason plan.Reason `json:"reason"`

	// What each side holds right now. Present for a conflict, where the whole
	// question is which of two versions to keep, and for a copy, where it says
	// what is about to be replaced.
	Left  *sideView `json:"left,omitempty"`
	Right *sideView `json:"right,omitempty"`
}

type planView struct {
	Actions   []actionView `json:"actions"`
	Dirs      []actionView `json:"dirs"`
	Skipped   []skipView   `json:"skipped"`
	Unchanged int          `json:"unchanged"`
	Agreed    int          `json:"agreed"`
}

// sideView is one side's version of a file: what it is called there, how big
// it is and when it changed. A conflict screen that cannot show those three
// things is asking somebody to choose between two names.
type sideView struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	Mod  string `json:"mod"`
}

type skipView struct {
	Path   string      `json:"path"`
	Reason plan.Reason `json:"reason"`
}

func (s *Server) previewJob(w http.ResponseWriter, r *http.Request) {
	p, err := s.Runner.Preview(r.Context(), r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, viewOf(p))
}

// sideOf renders what a side currently holds, or nothing when it holds nothing.
func sideOf(e *scan.Entry) *sideView {
	if e == nil {
		return nil
	}
	return &sideView{Path: e.Path, Size: e.Size, Mod: e.Mod.UTC().Format(time.RFC3339)}
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
		v.Left, v.Right = sideOf(a.LeftNow), sideOf(a.RightNow)
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

	// Resolve carries the decisions somebody made on the conflict rows, keyed
	// by path. An absent entry means the default, which keeps both versions.
	Resolve map[string]string `json:"resolve"`
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

	var resolve map[string]plan.Resolution
	if len(req.Resolve) > 0 {
		resolve = make(map[string]plan.Resolution, len(req.Resolve))
		for path, choice := range req.Resolve {
			resolve[path] = plan.ParseResolution(choice)
		}
	}

	// The browser tab is not the run's owner. Somebody navigating away, or a
	// laptop closing its lid, must not cancel a transfer that is already moving
	// files, so the work gets a context of its own.
	name := r.PathValue("name")
	go func() {
		if _, err := s.Runner.RunChosen(context.Background(), name, only, resolve); err != nil && !errors.Is(err, daemon.ErrAlreadyRunning) {
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
// spa serves the built interface, and falls back twice.
//
// A path that is not a file is answered with index.html, because the interface
// routes in the browser and a reload of any page has to reach it. And an
// index.html that is not there at all is answered with the page that explains
// why: that is a binary built without the frontend, which is a thing a plain
// `go build` produces, and a blank screen is indistinguishable from a broken
// one.
type spa struct {
	fs          fs.FS
	placeholder []byte
}

func (s spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	f, err := s.fs.Open(path[1:])
	if err != nil {
		index, iErr := s.fs.Open("index.html")
		if iErr != nil {
			s.explain(w)
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

func (s spa) explain(w http.ResponseWriter) {
	if len(s.placeholder) == 0 {
		http.Error(w, "this binary was built without the interface", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Not 404. The engine is running and the API is answering; what is missing
	// is a build step, and a status that says "there is nothing at this address"
	// would send somebody looking in the wrong place.
	w.WriteHeader(http.StatusOK)
	w.Write(s.placeholder)
}

type readSeeker interface {
	Read([]byte) (int, error)
	Seek(int64, int) (int64, error)
}

// readConfig hands the editor the jobs exactly as they stand in the file, not
// as the parsed struct sees them. A field this version does not understand
// survives being edited, and a relative path stays relative.
func (s *Server) readConfig(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.Runner.Config().JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if jobs == nil {
		jobs = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}

// writeConfig replaces the job list and reloads the schedules.
//
// The whole list arrives at once rather than one job at a time, because a
// configuration is validated as a whole: two jobs sharing a name is a defect
// neither of them can see on its own.
func (s *Server) writeConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Jobs []map[string]any `json:"jobs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}

	next, err := s.Runner.Config().SaveJobs(body.Jobs)
	if err != nil {
		// The validator's own words, so an edit here and a hand-written file
		// fail in exactly the same way.
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Runner.Reload(next)

	jobs, err := next.JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}
