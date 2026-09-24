// Package web serves the interface and the API behind it. The API exposes what
// the engine decides rather than deciding anything of its own.
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
	"strings"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/deskset"
	"github.com/junkerderprovinz/arrowloop/internal/engine"
	"github.com/junkerderprovinz/arrowloop/internal/history"
	"github.com/junkerderprovinz/arrowloop/internal/hold"
	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/scan"
	"github.com/junkerderprovinz/arrowloop/internal/security"
)

// Server answers the browser. It holds no configuration of its own: the runner
// owns the one copy.
type Server struct {
	History *history.DB
	Runner  *daemon.Runner

	// UI is the built interface. A nil filesystem serves the API only.
	UI fs.FS

	// Placeholder is the page served when UI carries no index.html, as in a
	// binary built without the frontend.
	Placeholder []byte

	// Window is set only by the desktop shell. A nil store leaves the window
	// routes unregistered, which tells the interface there is no window.
	Window *deskset.Store

	// Hold carries a reason, reported by the device the engine runs on, to stop
	// automatic runs. Only the phone sets it, knowing whether it is charging
	// and whether the connection is metered. A nil store leaves the routes
	// unregistered.
	Hold *hold.Store

	// Security keeps the password, the second factor and the passkeys set up
	// in the interface. A nil store leaves those routes unregistered and the
	// password to ARROWLOOP_PASSWORD_HASH alone, which is how the desktop
	// window runs: nobody else can reach it.
	Security *security.Store

	// Log reports what a status code cannot, such as a setting that saved but
	// could not be applied to the running process. Nil means silence.
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
	mux.HandleFunc("GET /api/jobs/{name}/duplicates/{side}", s.findDuplicates)
	mux.HandleFunc("GET /api/jobs/{name}/trash/{side}", s.listTrash)
	mux.HandleFunc("POST /api/jobs/{name}/trash/{side}/restore", s.restoreTrash)
	mux.HandleFunc("POST /api/jobs/{name}/trash/{side}/prune", s.pruneTrash)
	mux.HandleFunc("GET /api/jobs/{name}/versions/{side}", s.listVersions)
	mux.HandleFunc("POST /api/jobs/{name}/versions/{side}/restore", s.restoreVersion)
	mux.HandleFunc("GET /api/history", s.listHistory)
	mux.HandleFunc("GET /api/history/{id}/entries", s.runEntries)
	mux.HandleFunc("GET /api/history/{id}/summary", s.runSummary)
	mux.HandleFunc("GET /api/log", s.fileLog)
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

	// The routes an unauthenticated caller may reach are listed in
	// needsSession.
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /api/session", s.session)
	mux.HandleFunc("GET /api/security", s.securityStatus)

	if s.Security != nil {
		mux.HandleFunc("POST /api/security/password", s.setPassword)
		mux.HandleFunc("POST /api/security/password/remove", s.removePassword)
		mux.HandleFunc("POST /api/security/totp/setup", s.totpSetup)
		mux.HandleFunc("POST /api/security/totp/confirm", s.totpConfirm)
		mux.HandleFunc("POST /api/security/totp/disable", s.totpDisable)

		mux.HandleFunc("GET /api/passkeys", s.passkeyStatus)
		mux.HandleFunc("POST /api/passkeys/login/begin", s.passkeyLoginBegin)
		mux.HandleFunc("POST /api/passkeys/login/finish", s.passkeyLoginFinish)
		mux.HandleFunc("POST /api/passkeys/register/begin", s.passkeyRegisterBegin)
		mux.HandleFunc("POST /api/passkeys/register/finish", s.passkeyRegisterFinish)
		mux.HandleFunc("DELETE /api/passkeys/{id}", s.deletePasskey)
	}

	if s.Window != nil {
		mux.HandleFunc("GET /api/window", s.readWindow)
		mux.HandleFunc("PUT /api/window", s.writeWindow)
	}

	if s.Hold != nil {
		mux.HandleFunc("GET /api/device", s.readDevice)
		mux.HandleFunc("PUT /api/device", s.writeDevice)
	}

	// A phone's wake-up runs whatever the schedule says is due.
	mux.HandleFunc("POST /api/run-due", s.runDue)

	mux.HandleFunc("GET /api/remotes", s.listRemotes)
	mux.HandleFunc("PUT /api/remotes/{name}", s.saveRemote)
	mux.HandleFunc("DELETE /api/remotes/{name}", s.deleteRemote)
	mux.HandleFunc("POST /api/remotes/{name}/check", s.checkRemote)
	// Settings that are not saved yet, so a form can check them first.
	mux.HandleFunc("POST /api/remotes-check", s.tryRemote)
	mux.HandleFunc("GET /api/remotes/{name}/about", s.aboutRemote)

	// Otherwise the interface's fallback would answer an unknown API path
	// with its HTML and a 200, telling a client that probes for a feature
	// that it exists.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, fmt.Errorf("no such address: %s", r.URL.Path))
	})

	if s.UI != nil {
		mux.Handle("/", spa{fs: s.UI, placeholder: s.Placeholder, assets: &assets{}})
	}
	// Protect passes everything straight through when no password is set.
	return s.Protect(mux)
}

// jobView is one row of the job list.
type jobView struct {
	Name      string `json:"name"`
	Left      string `json:"left"`
	Right     string `json:"right"`
	Direction string `json:"direction"`
	Schedule  string `json:"schedule"`
	// Watch, because a watching job writes the same schedule as one that only
	// keeps to the clock.
	Watch       bool    `json:"watch"`
	Disabled    bool    `json:"disabled"`
	Running     bool    `json:"running"`
	LastSuccess *string `json:"lastSuccess"`
	// NextRun is when the schedule next reaches this job; see nextRun. It is a
	// due time, and a condition such as mains power may still hold the run.
	NextRun *string `json:"nextRun,omitempty"`
}

// nextRun is when the schedule will next reach this job. It is computed with
// the same Next the scheduler uses, so it needs no live scheduler. A job with
// no schedule, a disabled job and an expression that does not parse have no
// next run; a watching job still has its scheduled time.
func nextRun(j job.Job, now time.Time) (time.Time, bool) {
	if j.Disabled || strings.TrimSpace(j.Schedule) == "" {
		return time.Time{}, false
	}
	parsed, err := job.ParseSchedule(j.Schedule)
	if err != nil {
		return time.Time{}, false
	}
	return parsed.Next(now), true
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
			// Resolved, so an unset field and "both" look the same.
			Direction: directionName(plan.ParseDirection(j.Direction)),
			Schedule:  j.Schedule, Disabled: j.Disabled, Running: running[j.Name],
		}
		if when, ok, err := s.History.LastSuccess(r.Context(), j.Name); err == nil && ok {
			stamp := when.UTC().Format(time.RFC3339)
			v.LastSuccess = &stamp
		}
		if when, ok := nextRun(j, time.Now()); ok {
			stamp := when.UTC().Format(time.RFC3339)
			v.NextRun = &stamp
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

	// Reason carries the code and its values, which the interface translates,
	// and the English sentence it falls back to for a code it does not know.
	Reason plan.Reason `json:"reason"`

	// Left and Right are what each side holds right now: for a conflict the
	// two versions to choose from, for a copy what is about to be replaced.
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
// it is and when it changed.
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
		case plan.Copy, plan.Relocate:
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

// runRequest optionally narrows a run to the paths somebody ticked. An absent
// "only" means everything; a present, empty one means nothing, or unticking
// every row would run the whole plan.
type runRequest struct {
	Only *[]string `json:"only"`

	// Resolve carries the decisions somebody made on the conflict rows, keyed
	// by path. An absent entry means the default, which keeps both versions.
	Resolve map[string]string `json:"resolve"`
}

// stopJob asks a run that is going right now to stop. The answer says whether
// there was anything to stop, so the interface can tell "stopped it" from "it
// had already finished".
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

	// encoding/json decodes [] into a non-nil empty slice, so an empty
	// selection stays distinct from a missing field.
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

	// The run gets a context of its own, so navigating away does not cancel
	// a transfer in flight.
	name := r.PathValue("name")
	go func() {
		// A failure is already in the run log and goes to the notifier.
		_, _ = s.Runner.RunChosen(context.Background(), name, only, resolve)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"job": name, "status": "started"})
}

// parseDay reads a plain date in the machine's own time zone. With end set it
// means the last instant of the day, so "until the 9th" includes the 9th.
func parseDay(raw string, end bool) time.Time {
	if raw == "" {
		return time.Time{}
	}
	day, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return time.Time{}
	}
	if end {
		return day.AddDate(0, 0, 1).Add(-time.Nanosecond)
	}
	return day
}

func (s *Server) listHistory(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	// An unknown value shows everything: a filter that goes wrong must show
	// too much, never an empty history.
	var show history.Show
	switch history.Show(r.URL.Query().Get("show")) {
	case history.ShowChanged:
		show = history.ShowChanged
	case history.ShowFailed:
		show = history.ShowFailed
	default:
		show = history.ShowAll
	}
	// Either end is optional, and a date that does not parse is ignored for
	// the same reason.
	runs, err := s.History.Between(r.Context(), r.URL.Query().Get("job"), show,
		parseDay(r.URL.Query().Get("since"), false),
		parseDay(r.URL.Query().Get("until"), true),
		limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if runs == nil {
		runs = []history.Run{}
	}
	writeJSON(w, http.StatusOK, runs)
}

// jobTouches lists what one job did to individual files, newest first, across
// all of its runs.
func (s *Server) jobTouches(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	touches, err := s.History.TouchesLike(r.Context(), r.PathValue("name"), r.URL.Query().Get("q"), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if touches == nil {
		touches = []history.Touch{}
	}
	writeJSON(w, http.StatusOK, touches)
}

// fileLog is the per-file log across every job, narrowed in the database by
// job, a fragment of a path and what happened.
func (s *Server) fileLog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 100
	if raw := q.Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	// Empty pieces such as in kind=copy,,move are dropped; no entry has an
	// empty kind.
	var kinds []string
	for _, kind := range strings.Split(q.Get("kind"), ",") {
		if kind != "" {
			kinds = append(kinds, kind)
		}
	}
	touches, err := s.History.Log(r.Context(), history.Filter{
		Job:      q.Get("job"),
		Contains: q.Get("q"),
		Kinds:    kinds,
		Limit:    limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if touches == nil {
		touches = []history.Touch{}
	}
	writeJSON(w, http.StatusOK, touches)
}

// runSummary is what one run did, split by the side each file landed on. It is
// counted in the database, since runEntries answers with a page.
func (s *Server) runSummary(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("not a run id: %s", r.PathValue("id")))
		return
	}
	tally, err := s.History.Summarise(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, tally)
}

// runEntries lists what one run did, path by path. It is fetched when a run is
// opened rather than sent with every run in the list.
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

	// A comment line every twenty seconds keeps a proxy from closing the idle
	// stream.
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

// spa serves the built interface. A path that is not a file gets index.html,
// since the interface routes in the browser, and a missing index.html gets the
// placeholder page, as in a binary built with a plain go build.
type spa struct {
	fs          fs.FS
	placeholder []byte

	// assets fingerprints each embedded file once; see assets.go.
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
		// A browser holding a stale index.html asks for a bundle that no
		// longer exists, and must get a 404 rather than HTML where it
		// expected a script.
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
	// Not 404: the engine and the API work, and only a build step is missing.
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

// readRawConfig hands back the configuration file byte for byte, so a backup
// keeps unknown keys and relative paths.
func (s *Server) readRawConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// A stale backup is worse than none.
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(s.Runner.Config().Raw())
}

// replaceConfig puts a whole saved configuration back.
func (s *Server) replaceConfig(w http.ResponseWriter, r *http.Request) {
	// Four megabytes is far more than any real configuration.
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

// readSettings hands back the file's top-level keys apart from the jobs, as a
// map so keys this build does not know survive a round trip.
func (s *Server) readSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.Runner.Config().SettingsAsMap()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// writeSettings merges the keys it is given and reloads. A key the caller does
// not mention is kept; a setting is deleted by sending it empty.
func (s *Server) writeSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}

	next, err := s.Runner.Config().SaveSettings(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Runner.Reload(next)
	// The bandwidth limit lives in rclone's process-wide token bucket, which a
	// reload does not touch. The setting is saved either way, so a failure is
	// logged rather than returned.
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

// writeConfig replaces the job list and reloads the schedules. The whole list
// arrives at once, because two jobs sharing a name is only visible as a whole.
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
