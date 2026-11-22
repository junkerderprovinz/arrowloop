package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/certpin"
	"github.com/junkerderprovinz/arrowloop/internal/failure"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
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

	// Only a place a drive is looked for can be marked: a marker anywhere else
	// is never found again, and the request would write into any folder.
	mount, ok := offeredMount(body.Mount)
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Errorf("%s is not a drive ArrowLoop can see", body.Mount))
		return
	}

	m, err := volume.Mark(mount, body.Label)
	if err != nil {
		// Marking writes a file, so this is where a read-only drive says so.
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, volumeView{
		ID: m.ID, Label: m.Label, Mount: mount, Attached: true,
		Path: volume.Prefix + m.ID,
	})
}

// offeredMount returns the candidate mount that path names.
func offeredMount(path string) (string, bool) {
	want := filepath.Clean(path)
	for _, mount := range volume.Candidates() {
		if filepath.Clean(mount) == want {
			return mount, true
		}
	}
	return "", false
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
		Name   string `json:"name,omitempty"`
		Marked bool   `json:"marked"`
	}
	all := volume.Candidates()
	out := make([]candidate, 0, len(all))
	for _, mount := range all {
		out = append(out, candidate{Mount: mount, Name: volume.Name(mount), Marked: marked[mount]})
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
	// A form adding a target asks with ?new, so a name already in use is
	// refused rather than written over; an edit, and the phone, leave it off.
	save := remotes.Save
	if r.URL.Query().Has("new") {
		save = remotes.Create
	}
	// A setup that signs in fails the way a test of the same settings does,
	// and says so in the same terms.
	settings, question, err := remotes.Setup(r.Context(), body.Type, body.Settings)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error(), "failure": failure.Of(err.Error())})
		return
	}
	if question != nil {
		// A test asks the same question, which is where the form shows it.
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": "test the target first and answer " + question.Name, "code": setupQuestion, "question": question,
		})
		return
	}
	if err := save(r.PathValue("name"), body.Type, settings); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, remotes.ErrExists) {
			status = http.StatusConflict
		}
		writeError(w, status, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"saved": r.PathValue("name")})
}

// targetInUse is the code a refused delete answers with, so the page can name
// the jobs in its own words.
const targetInUse = "target-in-use"

func (s *Server) deleteRemote(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	// A job on a deleted target fails every run until somebody notices, and the
	// credentials cannot be had back from here.
	if jobs := s.jobsOn(name); len(jobs) > 0 {
		list := strings.Join(jobs, ", ")
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":  fmt.Sprintf("jobs still use %s: %s; point them at another target or delete them first", name, list),
			"code":   targetInUse,
			"values": map[string]string{"jobs": list},
		})
		return
	}
	if err := remotes.Delete(name); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": name})
}

// jobsOn names the jobs with a side on the target.
func (s *Server) jobsOn(target string) []string {
	var out []string
	for _, j := range s.Runner.Config().Jobs {
		if remotes.Reaches(j.Left, target) || remotes.Reaches(j.Right, target) {
			out = append(out, j.Name)
		}
	}
	return out
}

// setupQuestion is the code of a save that waits for an answer rclone's setup
// leaves open, such as which of several drives to use or a two-factor code.
const setupQuestion = "setup-question"

// targetVPN is the context a target is opened with outside a run: through the
// VPN of a job on it, the first one that has a VPN, so the target is reached
// the way its runs reach it and never past their tunnel. Without connect a
// tunnel no run holds up stays down, and opening the target fails with
// vpnconn.ErrNotUp.
func (s *Server) targetVPN(ctx context.Context, target string, connect bool) (context.Context, error) {
	for _, j := range s.Runner.Config().Jobs {
		if j.VPN == "" || !(remotes.Reaches(j.Left, target) || remotes.Reaches(j.Right, target)) {
			continue
		}
		if connect {
			return s.throughVPN(ctx, j)
		}
		return s.joinVPN(ctx, j)
	}
	return ctx, nil
}

// asked reports whether somebody asked for the request, which may then bring a
// job's VPN up; a page that looks on its own leaves it down.
func asked(r *http.Request) bool { return r.URL.Query().Get("connect") != "" }

// checkRemote proves the settings work, which saving them does not. A target
// behind a VPN that is down answers unchecked unless the check was asked for.
func (s *Server) checkRemote(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	ctx, err := s.targetVPN(r.Context(), name, asked(r))
	if errors.Is(err, vpnconn.ErrNotUp) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "unchecked": true, "reason": err.Error()})
		return
	}
	if err == nil {
		err = remotes.Check(ctx, name)
	}
	if err != nil {
		// 200 with a reason: a credential that does not work answers the
		// question rather than failing the request.
		writeJSON(w, http.StatusOK, refused(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// refused is a check's answer for settings that do not work: rclone's words,
// the kind of failure where the page has a sentence for it, and a refused
// certificate for the person to decide whether to trust it.
func refused(err error) map[string]any {
	answer := map[string]any{"ok": false, "reason": err.Error(), "failure": failure.Of(err.Error())}
	if cert, ok := certpin.Find(err); ok {
		answer["certificate"] = cert
	}
	return answer
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
	ctx := r.Context()
	if body.Name != "" {
		var err error
		if ctx, err = s.targetVPN(ctx, body.Name, true); err != nil {
			writeJSON(w, http.StatusOK, refused(err))
			return
		}
	}
	got, err := remotes.Try(ctx, body.Name, body.Type, body.Settings)
	if got.Question != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": "answer " + got.Question.Name + " and test again", "question": got.Question})
		return
	}
	answer := map[string]any{"ok": true}
	if err != nil {
		answer = refused(err)
	}
	// The key the server was held to, which the page shows to compare.
	if got.HostKey != nil {
		answer["hostKey"] = got.HostKey.Fingerprint
	}
	writeJSON(w, http.StatusOK, answer)
}

// aboutRemote reports how full a target is. It is its own route rather than a
// field on the listing, which would ask every target over the network whenever
// the page opens.
func (s *Server) aboutRemote(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	ctx, err := s.targetVPN(r.Context(), name, asked(r))
	var usage remotes.Usage
	if err == nil {
		usage, err = remotes.About(ctx, name)
	}
	if err != nil {
		// The reason tells an unreachable target from one that keeps no
		// total; both are unsupported.
		writeJSON(w, http.StatusOK, map[string]any{"supported": false, "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, usage)
}
