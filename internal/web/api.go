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
	"io"
	"io/fs"
	"net/http"
	"strconv"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
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

	// Window is set only by the desktop shell. A nil store leaves the two
	// window routes unregistered, which is how the interface knows there is no
	// window to have preferences about.
	Window *deskset.Store

	// Log is where this layer says the things it cannot answer with a status
	// code. There is exactly one of those: a setting that saved correctly and
	// then could not be applied to the running process. Answering a successful
	// save with an error would be the wrong lie in the other direction, and
	// saying nothing at all would be the failure mode this whole round was
	// about. Nil is allowed and means silence, which is what the tests want.
	Log func(format string, args ...any)
}

// logf is Log with the nil check in one place.
func (s *Server) logf(format string, args ...any) {
	if s.Log != nil {
		s.Log(format, args...)
	}
}

// Handler builds the routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/jobs", s.listJobs)
	mux.HandleFunc("GET /api/jobs/{name}/plan", s.previewJob)
	mux.HandleFunc("POST /api/jobs/{name}/run", s.runJob)
	mux.HandleFunc("POST /api/jobs/{name}/stop", s.stopJob)
	mux.HandleFunc("POST /api/jobs/{name}/check", s.checkJob)
	mux.HandleFunc("GET /api/jobs/{name}/verify", s.verifyJob)
	mux.HandleFunc("GET /api/jobs/{name}/trash/{side}", s.listTrash)
	mux.HandleFunc("POST /api/jobs/{name}/trash/{side}/restore", s.restoreTrash)
	mux.HandleFunc("POST /api/jobs/{name}/trash/{side}/prune", s.pruneTrash)
	mux.HandleFunc("GET /api/jobs/{name}/versions/{side}", s.listVersions)
	mux.HandleFunc("POST /api/jobs/{name}/versions/{side}/restore", s.restoreVersion)
	mux.HandleFunc("GET /api/history", s.listHistory)
	mux.HandleFunc("GET /api/history/{id}/entries", s.runEntries)
	mux.HandleFunc("GET /api/jobs/{name}/touches", s.jobTouches)
	mux.HandleFunc("GET /api/history/stats", s.historyStats)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/config", s.readConfig)
	mux.HandleFunc("PUT /api/config", s.writeConfig)
	mux.HandleFunc("GET /api/settings", s.readSettings)
	mux.HandleFunc("PUT /api/settings", s.writeSettings)
	mux.HandleFunc("GET /api/config/raw", s.readRawConfig)
	mux.HandleFunc("PUT /api/config/raw", s.replaceConfig)
	mux.HandleFunc("DELETE /api/jobs/{name}/state", s.forgetJobState)

	mux.HandleFunc("GET /api/volumes", s.listVolumes)
	mux.HandleFunc("GET /api/volumes/candidates", s.volumeCandidates)
	mux.HandleFunc("POST /api/volumes", s.markVolume)
	mux.HandleFunc("DELETE /api/volumes/{id}", s.forgetVolume)

	mux.HandleFunc("GET /api/browse", s.browse)
	mux.HandleFunc("POST /api/browse/mkdir", s.makeDir)
	mux.HandleFunc("GET /api/capabilities", s.capabilities)

	// The three routes an unauthenticated caller may reach. Everything else
	// under /api/ needs a session once a password hash is set, and nothing at
	// all changes when one is not: see Protect in auth.go.
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/session", s.session)

	if s.Window != nil {
		mux.HandleFunc("GET /api/window", s.readWindow)
		mux.HandleFunc("PUT /api/window", s.writeWindow)
	}

	mux.HandleFunc("GET /api/remotes", s.listRemotes)
	mux.HandleFunc("PUT /api/remotes/{name}", s.saveRemote)
	mux.HandleFunc("DELETE /api/remotes/{name}", s.deleteRemote)
	mux.HandleFunc("POST /api/remotes/{name}/check", s.checkRemote)

	// An address under /api that nothing has claimed is a mistake, and it has
	// to look like one.
	//
	// Without this the interface's own fallback answers it: every unknown API
	// path would come back as the application's HTML with a 200, so a client
	// asking whether a feature exists would be told yes and handed a web page.
	// That is exactly how the window settings were reached on a build that has
	// no window, and the only reason nothing broke is that the client happened
	// to fail on the parse instead of on the status.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, fmt.Errorf("no such address: %s", r.URL.Path))
	})

	if s.UI != nil {
		mux.Handle("/", spa{fs: s.UI, placeholder: s.Placeholder, assets: &assets{}})
	}
	// The whole tree goes through the gate, and the gate is a straight passthrough
	// when no password hash is set. That is the important half: an install that
	// never asked for a password must behave exactly as it did before this
	// existed, and the check for that is the first thing Protect does.
	return s.Protect(mux)
}

// jobView is one row of the job list.
type jobView struct {
	Name      string `json:"name"`
	Left      string `json:"left"`
	Right     string `json:"right"`
	Direction string `json:"direction"`
	Schedule  string `json:"schedule"`
	// Watch, because the schedule alone cannot say it. A watching job and one
	// that only keeps to the clock write the same expression: the watcher's is
	// the backstop behind it. Without this the card describes a job that reacts
	// in seconds as one that runs every hour, which is true and is the wrong
	// answer to "what does this do".
	Watch       bool    `json:"watch"`
	Disabled    bool    `json:"disabled"`
	Running     bool    `json:"running"`
	LastSuccess *string `json:"lastSuccess"`
}

// directionName is the name the interface keys off, which is the same spelling
// the configuration file accepts.
func directionName(d plan.Direction) string {
	switch d {
	case plan.LeftToRight:
		return "leftToRight"
	case plan.RightToLeft:
		return "rightToLeft"
	default:
		return "both"
	}
}

func (s *Server) listJobs(w http.ResponseWriter, r *http.Request) {
	running := s.Runner.Running()
	cfg := s.Runner.Config()
	out := make([]jobView, 0, len(cfg.Jobs))
	for _, j := range cfg.Jobs {
		v := jobView{
			Name: j.Name, Left: j.Left, Right: j.Right, Watch: j.Watch,
			// Sent resolved rather than as it stands in the file, so an
			// unset field and an explicit "both" reach the screen as the
			// same thing and the arrows never have to guess.
			Direction: directionName(plan.ParseDirection(j.Direction)),
			Schedule:  j.Schedule, Disabled: j.Disabled, Running: running[j.Name],
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

// stopJob asks a run that is going right now to stop.
//
// A separate verb from "run" rather than a toggle, because the two are not
// opposites a person would want to press blindly: starting is safe and
// stopping abandons work in flight. The answer says whether there was
// anything to stop, so the interface can tell "stopped it" from "it had
// already finished" - which is a real distinction to somebody who pressed the
// button a second too late.
func (s *Server) stopJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := s.Runner.Config().Find(name); !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stopped": s.Runner.Cancel(name)})
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
	// An unknown value is ALL rather than an error. This parameter narrows a
	// listing, so getting it wrong should show too much and never too little:
	// a typo that returned nothing would read as "there is no history", which
	// is the one answer this log must never give falsely.
	var show history.Show
	switch history.Show(r.URL.Query().Get("show")) {
	case history.ShowChanged:
		show = history.ShowChanged
	case history.ShowFailed:
		show = history.ShowFailed
	default:
		show = history.ShowAll
	}
	runs, err := s.History.Recent(r.Context(), r.URL.Query().Get("job"), show, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if runs == nil {
		runs = []history.Run{}
	}
	writeJSON(w, http.StatusOK, runs)
}

// runEntries lists what ONE run did, path by path.
//
// A separate request rather than a field on every run in the list, and that is
// the whole design of it: a page showing fifty runs wants fifty summaries, and
// fetching every path each of them touched to draw a row that says "12 copied"
// would be thousands of strings nobody reads. The detail is fetched when a run
// is opened, which is the moment somebody has asked for it.
// jobTouches lists what ONE job did to individual files, newest first, across
// all of its runs.
//
// Deliberately a different endpoint from the run log rather than a parameter on
// it: the two answer different questions. "Which runs happened" belongs to the
// history tab; "what has this job done to my files" is what somebody asks while
// looking at the job itself.
func (s *Server) jobTouches(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	touches, err := s.History.Touches(r.Context(), r.PathValue("name"), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if touches == nil {
		touches = []history.Touch{}
	}
	writeJSON(w, http.StatusOK, touches)
}

func (s *Server) runEntries(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("not a run id: %s", r.PathValue("id")))
		return
	}
	entries, err := s.History.Entries(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if entries == nil {
		// A nil slice encodes as null, and a page that expects a list would then
		// have to guard every use of it. An empty run is an empty list.
		entries = []history.Entry{}
	}
	writeJSON(w, http.StatusOK, entries)
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

	// One fingerprint per embedded file, worked out once. See assets.go for why
	// an embedded file has no validator of its own and what goes wrong without
	// one.
	assets *assets
}

func (s spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/" {
		path = "/index.html"
	}
	name := path[1:]

	f, err := s.fs.Open(name)
	if err != nil {
		// A missing file under assets/ is a MISSING FILE, not a page.
		//
		// The fallback below exists so a reload of a sub-page reaches the
		// interface's own router. Applying it to assets/ turns "this bundle is
		// gone" into "here is some HTML, with a 200", and a browser holding a
		// stale index.html then asks for a bundle that no longer exists and is
		// handed a web page where it expected a script. It fails silently and
		// keeps showing what it had. Exactly the trap already closed for /api/.
		if isFingerprinted(name) {
			http.NotFound(w, r)
			return
		}
		index, iErr := s.fs.Open("index.html")
		if iErr != nil {
			s.explain(w)
			return
		}
		defer index.Close()
		info, found := s.assets.info(s.fs, "index.html")
		setCacheHeaders(w, "index.html", info, found)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		http.ServeContent(w, r, "index.html", time.Time{}, index.(readSeeker))
		return
	}
	defer f.Close()
	info, found := s.assets.info(s.fs, name)
	setCacheHeaders(w, name, info, found)
	http.ServeContent(w, r, name, time.Time{}, f.(readSeeker))
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

// readRawConfig hands back the configuration file exactly as it stands.
//
// Bytes, not a re-serialised struct. A backup is only worth having if it comes
// back the same, including the keys this build has never heard of and the
// relative paths somebody wrote on purpose.
func (s *Server) readRawConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// Never cached: this is a file somebody is about to keep as a backup, and a
	// stale one is worse than none.
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.Runner.Config().Raw())
}

// replaceConfig puts a whole saved configuration back.
func (s *Server) replaceConfig(w http.ResponseWriter, r *http.Request) {
	// A cap, because this is a file upload and an unbounded read from a request
	// body is a way to be handed a gigabyte. Four megabytes is far more than any
	// real configuration and small enough to refuse cheaply.
	doc, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	next, err := s.Runner.Config().Replace(doc)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Runner.Reload(next)
	writeJSON(w, http.StatusOK, map[string]any{"jobs": len(next.Jobs)})
}

// readSettings hands back the file's top-level keys apart from the jobs.
//
// The whole map rather than a named struct, for the same reason the job editor
// works in maps: a key this build does not understand still has to survive
// being read and written by it. A struct would drop it silently on the way out.
func (s *Server) readSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.Runner.Config().SettingsAsMap()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// writeSettings merges the keys it is given and reloads.
//
// Merges rather than replaces: a caller sends the settings it edits, and a
// caller that has never heard of a key must not be able to remove it by not
// mentioning it. Deleting a setting is done by sending it empty, which is a
// deliberate act rather than an omission.
func (s *Server) writeSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}

	next, err := s.Runner.Config().SaveSettings(body)
	if err != nil {
		// The validator's own words, so an edit here and a hand-written file
		// fail in exactly the same way.
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Runner.Reload(next)
	// The bandwidth limit lives in rclone's process-wide token bucket, not in
	// the configuration the runner just swapped, so reloading is not enough:
	// the value was correct in the file and in this page, and the next transfer
	// still went at whatever speed the program booted with. A failure here is
	// logged rather than returned - the setting IS saved, and answering a
	// successful save with an error would be the wrong lie in the other
	// direction.
	if err := engine.ApplyBwLimit(r.Context(), next.BwLimit); err != nil {
		s.logf("could not apply the new bandwidth limit: %v", err)
	}
	settings, err := next.SettingsAsMap()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
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
