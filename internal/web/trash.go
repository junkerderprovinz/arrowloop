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

// The reserved directory, from the outside.
//
// Nothing this program does destroys a file outright: a deletion is a move into
// .arrowloop/trash, and an overwrite can be kept in .arrowloop/versions. Both of
// those were true and neither was reachable except with a file manager, which
// means the safety net existed and could not be used by the person it exists for.
//
// Every decision worth testing lives in internal/trash and not here. What is left
// in this file is the two things a handler is actually for: turning a request
// into the values that package takes, and turning its answer into JSON. That is
// also why the path check is not repeated here. Repeating it would produce a
// second copy of a rule that must never differ from the first, and the copy that
// drifts is always the one nobody is looking at.

// keptEntry is one thing in a reserved directory, as the screen sees it.
type keptEntry struct {
	// Path is where the file was in the synced tree, which is where restoring
	// it puts it back.
	Path  string `json:"path"`
	RunID string `json:"runId"`
	// Remote is where the file is right now, so that somebody who would rather
	// use a file manager can go and find it.
	Remote string `json:"remote"`
	Size   int64  `json:"size"`

	// Filed is when the run that put this here happened, and null means it is
	// not known. A null rather than a zero date, because the difference decides
	// whether pruning by age may touch this entry, and a screen showing the first
	// of January 1970 would be inventing an answer to that.
	Filed *string `json:"filed"`

	// Modified is what the file says about itself. It is NOT when the file was
	// deleted: moving a file into the trash preserves its modification time, so
	// a document last edited years ago can have been deleted a minute ago.
	Modified string `json:"modified"`
}

type keptAnswer struct {
	Job   string `json:"job"`
	Side  string `json:"side"`
	Store string `json:"store"`
	Dir   string `json:"dir"`
	// Total is how many entries the side holds, which is not always how many are
	// listed below. A screen that showed a capped list with no count would tell
	// somebody their trash was empty enough.
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
	// Capped, because this is a whole trash and a year of deletions is a list
	// no browser should be handed at once. The cap is on what is sent and never
	// on what is counted: the walk had to read everything to answer at all, so
	// hiding the total would cost nothing and lose the only number that says
	// whether the list is complete.
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

// keptRequest names one entry, by the two things that identify it.
//
// A path and a run, never the remote from the listing. The listing is a
// convenience for a screen and whatever comes back over the wire is whatever the
// caller chose to send, so a remote that this program once produced is not
// evidence of anything by the time it returns. internal/trash rebuilds the
// location from these two values and checks both.
type keptRequest struct {
	Path  string `json:"path"`
	RunID string `json:"runId"`
}

// restoreTrash puts one trashed file back where it came from.
//
// POST and not GET, for the reason the write probe and the remote check are
// both POSTs here: this writes to somebody's tree, and a GET that moves a file
// is a GET a cache or a link prefetcher is entitled to fire on their behalf.
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
		// The counts go out alongside the failure rather than being thrown away.
		// A prune that removed nine runs and then failed on the tenth has done
		// nine irreversible things, and an answer that only carried the error
		// would leave a screen showing a trash it no longer describes.
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

// entryRequest is the half every write route shares: open the side, read the
// two values that name an entry, and answer the request itself when either
// fails.
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

// restoreStatus turns a refusal into the status that says which kind it was.
//
// The one worth separating is a name that is already taken. That is a correct
// request the program declined in order not to destroy the newer file, so the
// caller is entitled to recognise it and offer somewhere else to put the old
// one. Everything else in this family is a request that was never valid.
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

// trashStore reads which of the two trash directories is meant.
//
// A NAME from a closed set, resolved by internal/trash, never a directory. That
// is the shape internal/web/state.go established for reaching a file on somebody
// else's disk: a caller who cannot say a path cannot say a path outside the tree.
// The default is the current trash, so the ordinary request carries nothing.
func trashStore(w http.ResponseWriter, r *http.Request) (trash.Store, bool) {
	name := r.URL.Query().Get("store")
	if name == "" {
		return trash.Trash, true
	}
	store, ok := trash.StoreNamed(name)
	if !ok || store.Name() == trash.Versions.Name() {
		// The versions store is deliberately not reachable from the trash
		// routes. It is filed the other way round and it is pruned by count
		// rather than by age, so a prune request aimed at it through here would
		// be a request the other half of this file cannot honour.
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
// "right".
//
// A name and a word, both looked up rather than used, which is the whole reason
// this is safe to expose. The path is read out of the job's own entry in the
// configuration, so a caller cannot name a folder, and therefore cannot name a
// folder belonging to somebody else. It is exactly what forgetJobState does with
// the state database and for exactly the same reason.
//
// The volume is resolved before the backend is opened, which is what
// daemon.Runner.open does and is not a formality: a drive letter that has since
// been handed to a different disk is not empty, and a trash listing that opened
// it would confidently describe somebody else's files.
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
		// Not an error of the request. The drive is in somebody's bag, which is
		// an answer rather than a fault, and it is the same wording the runner
		// and the precheck use for it.
		return nil, http.StatusServiceUnavailable, fmt.Errorf("the drive the %s side lives on is not attached: %s", side, volume.Describe(spec))
	}
	f, err := rclonefs.NewFs(ctx, resolved)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("the %s side could not be opened: %w", side, err)
	}
	return f, http.StatusOK, nil
}

// sideSpec turns the one word a caller may send into the side it names.
//
// A closed set of two, matched exactly. Anything else is refused rather than
// defaulted, because a typo that silently meant "left" would restore a file onto
// the wrong machine and report success.
func sideSpec(j job.Job, side string) (string, error) {
	switch side {
	case "left":
		return j.Left, nil
	case "right":
		return j.Right, nil
	}
	return "", fmt.Errorf("a job has a left side and a right side, and %q is neither", side)
}
