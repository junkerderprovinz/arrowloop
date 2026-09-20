package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	rclonefs "github.com/rclone/rclone/fs"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/trash"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// The trash and versions handlers only translate between requests and
// internal/trash, which holds every decision, including the path check.

// keptEntry is one thing in a reserved directory, as the screen sees it.
type keptEntry struct {
	// Path is where the file was in the synced tree, which is where restoring
	// it puts it back.
	Path  string `json:"path"`
	RunID string `json:"runId"`
	// Remote is where the file is right now, for somebody using a file
	// manager.
	Remote string `json:"remote"`
	Size   int64  `json:"size"`

	// Filed is when the run that put this here happened, or null when that is
	// not known, which keeps the entry safe from pruning by age.
	Filed *string `json:"filed"`

	// Modified is the file's own modification time, which a move into the
	// trash preserves; it is not when the file was deleted.
	Modified string `json:"modified"`
}

type keptAnswer struct {
	Job   string `json:"job"`
	Side  string `json:"side"`
	Store string `json:"store"`
	Dir   string `json:"dir"`
	// Total is how many entries the side holds, which can be more than are
	// listed.
	Total   int         `json:"total"`
	Entries []keptEntry `json:"entries"`
}

// listTrash reads what one side's trash holds.
func (s *Server) listTrash(w http.ResponseWriter, r *http.Request) {
	store, ok := trashStore(w, r)
	if !ok {
		return
	}
	s.listKept(w, r, store)
}

// listVersions reads the versions one side has kept.
func (s *Server) listVersions(w http.ResponseWriter, r *http.Request) {
	s.listKept(w, r, trash.Versions)
}

func (s *Server) listKept(w http.ResponseWriter, r *http.Request, store trash.Store) {
	name, side := r.PathValue("name"), r.PathValue("side")
	f, code, err := s.sideOf(r.Context(), name, side)
	if err != nil {
		writeError(w, code, err)
		return
	}

	entries, err := trash.List(r.Context(), f, store)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}

	out := keptAnswer{Job: name, Side: side, Store: store.Name(), Dir: store.Dir(), Total: len(entries)}
	// The cap is on what is sent, not on what is counted.
	entries = entries[:min(len(entries), keptLimit(r))]
	out.Entries = make([]keptEntry, 0, len(entries))
	for _, e := range entries {
		view := keptEntry{
			Path:     e.Path,
			RunID:    e.RunID,
			Remote:   e.Remote,
			Size:     e.Size,
			Modified: e.Modified.UTC().Format(time.RFC3339),
		}
		if e.Known() {
			filed := e.Filed.UTC().Format(time.RFC3339)
			view.Filed = &filed
		}
		out.Entries = append(out.Entries, view)
	}
	writeJSON(w, http.StatusOK, out)
}

// keptRequest names one entry by path and run, never by the remote from the
// listing, which the caller could have changed. internal/trash rebuilds the
// location from these two values and checks both.
type keptRequest struct {
	Path  string `json:"path"`
	RunID string `json:"runId"`
}

// restoreTrash puts one trashed file back where it came from. It is a POST,
// since a prefetcher may fire a GET.
func (s *Server) restoreTrash(w http.ResponseWriter, r *http.Request) {
	store, ok := trashStore(w, r)
	if !ok {
		return
	}
	name, side := r.PathValue("name"), r.PathValue("side")
	f, req, ok := s.entryRequest(w, r)
	if !ok {
		return
	}

	if err := trash.Restore(r.Context(), f, store, req.Path, req.RunID); err != nil {
		writeError(w, restoreStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"job": name, "side": side, "store": store.Name(), "restored": req.Path,
	})
}

// restoreVersion puts one kept version back as the live file.
func (s *Server) restoreVersion(w http.ResponseWriter, r *http.Request) {
	name, side := r.PathValue("name"), r.PathValue("side")
	f, req, ok := s.entryRequest(w, r)
	if !ok {
		return
	}

	if err := trash.RestoreVersion(r.Context(), f, req.Path, req.RunID, time.Now()); err != nil {
		writeError(w, restoreStatus(err), err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"job": name, "side": side, "store": trash.Versions.Name(), "restored": req.Path,
	})
}

// pruneTrash removes whole runs older than the age it is given.
func (s *Server) pruneTrash(w http.ResponseWriter, r *http.Request) {
	store, ok := trashStore(w, r)
	if !ok {
		return
	}
	name, side := r.PathValue("name"), r.PathValue("side")
	f, code, err := s.sideOf(r.Context(), name, side)
	if err != nil {
		writeError(w, code, err)
		return
	}

	var body struct {
		OlderThanDays int `json:"olderThanDays"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	cutoff, err := trash.Cutoff(time.Now(), body.OlderThanDays)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	pruned, err := trash.PruneOlderThan(r.Context(), f, store, cutoff)
	if err != nil {
		// The counts go out with the failure, since what was already pruned
		// cannot be undone.
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": err.Error(), "job": name, "side": side, "store": store.Name(),
			"runs": pruned.Runs, "entries": pruned.Entries, "bytes": pruned.Bytes, "unknown": pruned.Unknown,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"job": name, "side": side, "store": store.Name(),
		"runs": pruned.Runs, "entries": pruned.Entries, "bytes": pruned.Bytes, "unknown": pruned.Unknown,
	})
}

// entryRequest reads the entry a write route names and opens its side,
// answering the request itself when either fails.
func (s *Server) entryRequest(w http.ResponseWriter, r *http.Request) (rclonefs.Fs, keptRequest, bool) {
	var req keptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return nil, req, false
	}
	f, code, err := s.sideOf(r.Context(), r.PathValue("name"), r.PathValue("side"))
	if err != nil {
		writeError(w, code, err)
		return nil, req, false
	}
	return f, req, true
}

// restoreStatus turns a refusal into a status. A name that is already taken is
// a conflict, so the caller can offer somewhere else to put the old file.
func restoreStatus(err error) int {
	var exists *trash.ExistsError
	switch {
	case errors.As(err, &exists):
		return http.StatusConflict
	case errors.Is(err, trash.ErrNotAName):
		return http.StatusBadRequest
	default:
		return http.StatusBadGateway
	}
}

// trashStore reads which trash directory is meant, as a name from a closed set
// rather than a path, so a caller cannot name anything outside the tree. The
// default is the current trash.
func trashStore(w http.ResponseWriter, r *http.Request) (trash.Store, bool) {
	name := r.URL.Query().Get("store")
	if name == "" {
		return trash.Trash, true
	}
	store, ok := trash.StoreNamed(name)
	if !ok || store.Name() == trash.Versions.Name() {
		// Versions are filed differently and pruned by count, not by age.
		writeError(w, http.StatusBadRequest, fmt.Errorf("there is no trash called %q", name))
		return trash.Store{}, false
	}
	return store, true
}

// keptLimit is how many entries a listing sends, defaulting to enough that an
// ordinary trash arrives whole.
func keptLimit(r *http.Request) int {
	const fallback = 500
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}

// sideOf opens one end of one job, by the job's name and the word "left" or
// "right". The path comes from the job's configuration, so a caller cannot
// name a folder of its own. The volume is resolved first, as the runner does,
// so a drive letter given to another disk is not opened.
func (s *Server) sideOf(ctx context.Context, name, side string) (rclonefs.Fs, int, error) {
	j, ok := s.Runner.Config().Find(name)
	if !ok {
		return nil, http.StatusNotFound, fmt.Errorf("no job called %q", name)
	}
	spec, err := sideSpec(j, side)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	if spec == "" {
		return nil, http.StatusBadRequest, fmt.Errorf("job %q has no %s side yet", name, side)
	}

	resolved, err := volume.Resolve(spec)
	if err != nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("the drive the %s side lives on is not attached: %s", side, volume.Describe(spec))
	}
	f, err := rclonefs.NewFs(ctx, resolved)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("the %s side could not be opened: %w", side, err)
	}
	return f, http.StatusOK, nil
}

// sideSpec turns "left" or "right" into the side it names. Anything else is
// refused rather than defaulted, so a typo cannot restore onto the wrong side.
func sideSpec(j job.Job, side string) (string, error) {
	switch side {
	case "left":
		return j.Left, nil
	case "right":
		return j.Right, nil
	}
	return "", fmt.Errorf("a job has a left side and a right side, and %q is neither", side)
}
