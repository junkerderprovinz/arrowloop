package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"

	rcloneconfig "github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/fspath"

	"github.com/junkerderprovinz/parleyport/kit/group"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// openedJob is one job as another member edits it: the entry as the file has
// it, without its commands, and the defaults it falls back on here, so the
// form shows what the job runs with.
type openedJob struct {
	Job      map[string]any `json:"job"`
	Defaults job.Defaults   `json:"defaults"`
}

// placesView is what a side on this instance can name, for the folder picker
// of another member: the targets by name, the marked drives and the names of
// the exclude sets. No target's settings travel, its secrets least of all.
type placesView struct {
	Targets     []placeTarget `json:"targets"`
	Drives      []placeDrive  `json:"drives"`
	ExcludeSets []string      `json:"excludeSets"`
}

type placeTarget struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Provider string `json:"provider,omitempty"`
	Mark     string `json:"mark,omitempty"`
}

type placeDrive struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Path     string `json:"path"`
	Attached bool   `json:"attached"`
}

func (s *Server) groupReadJob(w http.ResponseWriter, r *http.Request) {
	cfg := s.Runner.Config()
	jobs, err := cfg.JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	at := jobAt(jobs, r.PathValue("name"))
	if at < 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", r.PathValue("name")))
		return
	}
	writeJSON(w, http.StatusOK, openedJob{Job: withoutCommands(jobs[at]), Defaults: cfg.Defaults})
}

func (s *Server) groupSaveJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	who := s.callerName(r)
	var entry map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&entry); err != nil || entry == nil {
		writeError(w, http.StatusBadRequest, errors.New("send the job as a JSON object"))
		return
	}

	s.saving.Lock()
	defer s.saving.Unlock()
	cfg := s.Runner.Config()
	jobs, err := cfg.JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	at := jobAt(jobs, name)
	if at < 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	saved, err := fitForOwner(entry, jobs[at], s.groupReach(jobs))
	if err == nil {
		jobs[at] = entry
		var next *job.Config
		if next, err = cfg.SaveJobs(jobs); err == nil {
			s.Runner.Reload(next)
			cfg = next
		}
	}
	if err != nil {
		s.logf("pairing: refused the change %s sent for the job %q: %v", who, name, err)
		s.writeRefusal(w, err)
		return
	}
	if saved == name {
		s.logf("pairing: %s saved the job %q here", who, name)
	} else {
		s.logf("pairing: %s saved the job %q here under the new name %q", who, name, saved)
	}

	jobs, err = cfg.JobsAsMaps()
	if at = jobAt(jobs, saved); err != nil || at < 0 {
		writeError(w, http.StatusInternalServerError, errors.New("the job was saved but cannot be read back"))
		return
	}
	writeJSON(w, http.StatusOK, openedJob{Job: withoutCommands(jobs[at]), Defaults: cfg.Defaults})
}

func (s *Server) groupPlaces(w http.ResponseWriter, _ *http.Request) {
	out := placesView{Targets: []placeTarget{}, Drives: []placeDrive{}, ExcludeSets: []string{}}
	for _, t := range remotes.List() {
		out.Targets = append(out.Targets, placeTarget{Name: t.Name, Type: t.Type, Provider: t.Provider, Mark: t.Mark})
	}
	for _, d := range volume.Remembered() {
		out.Drives = append(out.Drives, placeDrive{ID: d.ID, Label: d.Label, Path: volume.Prefix + d.ID, Attached: d.Attached})
	}
	for set := range s.Runner.Config().ExcludeSets {
		out.ExcludeSets = append(out.ExcludeSets, set)
	}
	sort.Strings(out.ExcludeSets)
	writeJSON(w, http.StatusOK, out)
}

// groupBrowse lists the folders another member may pick a side from: at the
// top the local folders the jobs here use, and below them, on a marked drive
// or on a target, only what a side from the group may name.
func (s *Server) groupBrowse(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.Runner.Config().JobsAsMaps()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	reach := s.groupReach(jobs)
	at := r.URL.Query().Get("path")
	if at == "" {
		// By the folder's own name, which a narrow picker shows whole, unless
		// two roots share it.
		named := map[string]int{}
		for _, root := range reach.roots {
			named[filepath.Base(root)]++
		}
		out := make([]browseEntry, 0, len(reach.roots))
		for _, root := range reach.roots {
			name := filepath.Base(root)
			if named[name] > 1 {
				name = root
			}
			out = append(out, browseEntry{Name: name, Path: root})
		}
		writeJSON(w, http.StatusOK, browseAnswer{Entries: out})
		return
	}
	if err := reach.side(at); err != nil {
		s.writeRefusal(w, err)
		return
	}
	answer, err := folderListing(r.Context(), at)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if answer.Parent != "" && reach.side(answer.Parent) != nil {
		answer.Parent = ""
	}
	writeJSON(w, http.StatusOK, answer)
}

// writeRefusal answers a change from the group this instance does not take,
// with the code and the values the interface words it by.
func (s *Server) writeRefusal(w http.ResponseWriter, err error) {
	var refused *refusedSide
	if !errors.As(err, &refused) {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error":  refused.why,
		"code":   refused.code,
		"values": map[string]string{"side": refused.side, "name": s.instanceName(s.Pairing.Get())},
	})
}

// callerName names the member a call from the group came from in this
// instance's log: by the name it announces and by its id, which no other
// member can take.
func (s *Server) callerName(r *http.Request) string {
	c, ok := group.CallerOf(r.Context())
	if !ok {
		return "an unknown instance"
	}
	for _, m := range s.instances() {
		if m.ID == c.ID && m.Name != "" {
			return fmt.Sprintf("the instance %q (%s)", m.Name, c.ID)
		}
	}
	return "the instance " + c.ID
}

// jobAt is the place of the job called name in jobs as the file holds them,
// or -1.
func jobAt(jobs []map[string]any, name string) int {
	for i, j := range jobs {
		if j["name"] == name {
			return i
		}
	}
	return -1
}

// withoutCommands is a job without the commands it runs. They run on this
// machine and may carry a token, so another member neither sees nor sets them.
func withoutCommands(entry map[string]any) map[string]any {
	out := make(map[string]any, len(entry))
	for k, v := range entry {
		if !job.IsCommandKey(k) {
			out[k] = v
		}
	}
	return out
}

// ownerKeys are the job's settings that stay as the owner set them, whatever
// the group sends: the state database, which would otherwise be written
// wherever the group says, and the trash and the brakes, which keep a
// mirror the group sets up from deleting outright and unchecked.
var ownerKeys = []string{"state", "noTrash", "brakePercent", "changePercent", "brakeFloor"}

// fitForOwner makes entry what another member may save over stored, and
// returns the name it saves under. Keys are compared in any case, as Load
// reads them.
func fitForOwner(entry, stored map[string]any, reach groupReach) (string, error) {
	for key := range entry {
		if job.IsCommandKey(key) || isOwnerKey(key) {
			delete(entry, key)
		}
	}
	for key, v := range stored {
		if isOwnerKey(key) {
			entry[key] = v
		}
	}
	// Load takes a key in any case, so a second spelling would be the one
	// that counts while the checks below read the first.
	for _, key := range []string{"name", "left", "right"} {
		n := 0
		for k := range entry {
			if strings.EqualFold(k, key) {
				n++
			}
		}
		if n > 1 {
			return "", fmt.Errorf("the job names its %s more than once", key)
		}
	}
	name, _ := field(entry, "name").(string)
	name = strings.TrimSpace(name)
	if err := checkJobName(name); err != nil {
		return "", err
	}
	for k := range entry {
		if strings.EqualFold(k, "name") {
			delete(entry, k)
		}
	}
	entry["name"] = name

	// The commands read the sides from the environment, so a side from the
	// group would hand its own path to a command that runs here.
	if runsCommands(stored) {
		for _, key := range []string{"name", "left", "right"} {
			if fmt.Sprint(field(entry, key)) != fmt.Sprint(field(stored, key)) {
				return "", &refusedSide{code: jobCommands, why: "this job runs commands before or after its runs here, so its name and its sides are changed on this instance itself"}
			}
		}
	}

	for key, v := range entry {
		if !strings.EqualFold(key, "left") && !strings.EqualFold(key, "right") {
			continue
		}
		side, _ := v.(string)
		side = strings.TrimSpace(side)
		// A side the owner chose stays the owner's choice.
		if side == strings.TrimSpace(fmt.Sprint(field(stored, key))) {
			continue
		}
		if err := reach.side(side); err != nil {
			return "", err
		}
		if parsed, err := fspath.Parse(side); err == nil && parsed.Name == "" && side != "" {
			side = filepath.Clean(side)
		}
		entry[key] = side
	}
	return name, nil
}

func isOwnerKey(key string) bool {
	for _, k := range ownerKeys {
		if strings.EqualFold(key, k) {
			return true
		}
	}
	return false
}

// field is the value m holds under key in any case, nil for none.
func field(m map[string]any, key string) any {
	for k, v := range m {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return nil
}

func runsCommands(j map[string]any) bool {
	for k, v := range j {
		if s, _ := v.(string); job.IsCommandKey(k) && strings.TrimSpace(s) != "" {
			return true
		}
	}
	return false
}

// The codes a refused change from the group answers with, which the interface
// says in the reader's language.
const (
	sideOutside = "group-side-outside"
	sideShare   = "group-side-share"
	sidePrivate = "group-side-private"
	jobCommands = "group-commands"
)

// refusedSide is a change from the group this instance does not take.
type refusedSide struct {
	code, side, why string
}

func (e *refusedSide) Error() string { return e.why }

func outside(side string) error {
	return &refusedSide{code: sideOutside, side: side, why: fmt.Sprintf(
		"%s is not for another instance to choose here. It may name a target by its name, a marked drive, or a folder at or below one a job here already uses", side)}
}

// groupReach is what a side from another instance of the group may name here:
// a target by its name, a marked drive, or a folder at or below a local side a
// job here already has. A network share by its address and this instance's
// own folders stay out of reach, since a job could copy files out to the one
// and overwrite the settings and their commands in the other.
type groupReach struct {
	targets map[string]bool
	drives  map[string]bool
	// roots are the local folders the jobs here use, and private the
	// folders of the configuration and of the targets' settings.
	roots   []string
	private []string
}

// groupReach is what the group may name here, given the jobs as the file
// holds them before a save.
func (s *Server) groupReach(jobs []map[string]any) groupReach {
	g := groupReach{targets: map[string]bool{}, drives: map[string]bool{}}
	for _, t := range remotes.List() {
		g.targets[t.Name] = true
	}
	for _, d := range volume.Remembered() {
		g.drives[d.ID] = true
	}
	for _, dir := range []string{s.Runner.Config().Dir(), filepath.Dir(rcloneconfig.GetConfigPath())} {
		if filepath.IsAbs(dir) {
			g.private = append(g.private, filepath.Clean(dir))
		}
	}
	seen := map[string]bool{}
	for _, j := range jobs {
		for _, key := range []string{"left", "right"} {
			side, _ := field(j, key).(string)
			dir, ok := job.LocalFolder(strings.TrimSpace(side))
			if !ok || isShare(dir) || !filepath.IsAbs(dir) {
				continue
			}
			dir = filepath.Clean(dir)
			if !seen[foldCase(dir)] && !g.isPrivate(dir) {
				seen[foldCase(dir)] = true
				g.roots = append(g.roots, dir)
			}
		}
	}
	return g
}

// side refuses a side the group may not name here.
func (g groupReach) side(side string) error {
	side = strings.TrimSpace(side)
	switch {
	case side == "":
		return nil
	case isShare(side):
		return &refusedSide{code: sideShare, side: side, why: fmt.Sprintf(
			"%s is a network share by its address, which a job here takes only from this instance itself", side)}
	case strings.HasPrefix(side, volume.Prefix):
		return g.drive(side)
	}
	parsed, err := fspath.Parse(side)
	// A connection string or a target's settings changed in the side would
	// point this instance's credentials, or its links, anywhere.
	if err != nil || strings.HasPrefix(parsed.Name, ":") || parsed.Config != nil || (parsed.Name != "" && !g.targets[parsed.Name]) {
		return outside(side)
	}
	if dir, ok := job.LocalFolder(side); ok {
		return g.folder(side, dir)
	}
	if parsed.Name == "" || climbs(parsed.Path) {
		return outside(side)
	}
	return nil
}

// drive refuses a side on a drive this instance has not marked, or one that
// climbs off it.
func (g groupReach) drive(side string) error {
	id, sub, _ := strings.Cut(strings.TrimPrefix(side, volume.Prefix), "/")
	sub = strings.Trim(sub, "/")
	if !g.drives[id] || climbs(sub) || (sub != "" && !filepath.IsLocal(filepath.FromSlash(sub))) {
		return outside(side)
	}
	if dir, err := volume.Resolve(volume.Prefix + id + "/" + sub); err == nil && g.isPrivate(dir) {
		return private(side)
	}
	return nil
}

// folder refuses a folder on this machine outside the roots or inside one of
// the private folders. Links are followed, so one under a root cannot lead out
// of it.
func (g groupReach) folder(side, dir string) error {
	if isShare(dir) {
		return &refusedSide{code: sideShare, side: side, why: fmt.Sprintf(
			"%s is a network share by its address, which a job here takes only from this instance itself", side)}
	}
	if !filepath.IsAbs(dir) {
		return outside(side)
	}
	dir = filepath.Clean(dir)
	real := realPath(dir)
	for _, root := range g.roots {
		if !within(root, dir) || !within(realPath(root), real) {
			continue
		}
		if g.isPrivate(dir) {
			return private(side)
		}
		return nil
	}
	return outside(side)
}

// isPrivate reports whether dir is one of the private folders or inside one.
func (g groupReach) isPrivate(dir string) bool {
	for _, p := range g.private {
		if within(p, dir) || within(realPath(p), realPath(dir)) {
			return true
		}
	}
	return false
}

func private(side string) error {
	return &refusedSide{code: sidePrivate, side: side, why: fmt.Sprintf(
		"%s holds this instance's own settings, which no job may take from another instance", side)}
}

// isShare reports whether p names a network share or a device by its
// address, as \\host\share, //host/share or \\?\.
func isShare(p string) bool {
	sep := func(c byte) bool { return c == '/' || c == '\\' }
	return len(p) >= 2 && sep(p[0]) && sep(p[1])
}

// climbs reports whether a path on a target or a drive has a step up in it,
// in either kind of separator.
func climbs(p string) bool {
	return slices.Contains(strings.FieldsFunc(p, func(r rune) bool { return r == '/' || r == '\\' }), "..")
}

// within reports whether p is root or a folder below it.
func within(root, p string) bool {
	rel, err := filepath.Rel(foldCase(root), foldCase(p))
	return err == nil && (rel == "." || filepath.IsLocal(rel))
}

// foldCase is p as Windows compares paths, which ignores case.
func foldCase(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

// realPath is p with its links followed, as far as it exists.
func realPath(p string) string {
	rest := ""
	for dir := p; ; {
		if real, err := filepath.EvalSymlinks(dir); err == nil {
			return filepath.Join(real, rest)
		}
		up := filepath.Dir(dir)
		if up == dir {
			return p
		}
		rest = filepath.Join(filepath.Base(dir), rest)
		dir = up
	}
}

// instanceJobConfig opens or saves a job of another instance of the group.
func (s *Server) instanceJobConfig(w http.ResponseWriter, r *http.Request) {
	s.toInstance(w, r, "/api/jobs/"+url.PathEscape(r.PathValue("name"))+"/config")
}

// instancePlaces lists what a side on another instance can name.
func (s *Server) instancePlaces(w http.ResponseWriter, r *http.Request) {
	s.toInstance(w, r, "/api/places")
}

// instanceBrowse lists the folders in one folder of another instance.
func (s *Server) instanceBrowse(w http.ResponseWriter, r *http.Request) {
	s.toInstance(w, r, "/api/browse?path="+url.QueryEscape(r.URL.Query().Get("path")))
}

// toInstance passes the call on to the instance of the group the address
// names, as path there, and hands its answer back as it came.
func (s *Server) toInstance(w http.ResponseWriter, r *http.Request, path string) {
	var body []byte
	if r.Method != http.MethodGet {
		read, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
			return
		}
		body = read
	}
	ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
	defer cancel()
	g := s.joined()
	if g == nil {
		writeError(w, http.StatusNotFound, errors.New("this instance is in no group"))
		return
	}
	status, out, err := g.Call(ctx, r.PathValue("id"), r.Method, path, body)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(err, group.ErrUnreachable) {
			code = http.StatusNotFound
		}
		writeError(w, code, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(out)
}
