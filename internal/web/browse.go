package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// The folder picker lets a job's sides be picked rather than typed, since a
// mistyped path is a valid string and fails quietly. It is not confined to a
// root: a desktop build has to reach any folder its user can, and the API can
// already start a job that deletes files, which is why it listens on loopback.

type browseEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type browseAnswer struct {
	// Path is where the listing came from. Empty means the list of drives at
	// the top of a Windows tree.
	Path string `json:"path"`
	// Parent is the folder one level up, or empty when there is none. The
	// server gives it because the answer differs between systems.
	Parent  string        `json:"parent"`
	Entries []browseEntry `json:"entries"`
}

// browse lists the folders inside one folder. Files are left out, since a
// job's side is always a folder.
func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	at := r.URL.Query().Get("path")

	if at == "" {
		roots, err := browseRoots()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, browseAnswer{Entries: roots})
		return
	}

	// Cleaned, so a stray "..\" cannot make the path mean something other
	// than it reads.
	at = filepath.Clean(at)

	entries, err := os.ReadDir(at)
	if err != nil {
		http.Error(w, "cannot read "+at+": "+err.Error(), http.StatusBadRequest)
		return
	}

	out := make([]browseEntry, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		out = append(out, browseEntry{Name: e.Name(), Path: filepath.Join(at, e.Name())})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })

	writeJSON(w, http.StatusOK, browseAnswer{Path: at, Parent: parentOf(at), Entries: out})
}

// parentOf is the folder above, or empty at the top. filepath.Dir returns a
// root unchanged, which is how a root is recognised on every system; the empty
// answer means the list of drives.
func parentOf(at string) string {
	up := filepath.Dir(at)
	if up == at {
		return ""
	}
	return up
}

// androidRoots are the folders a phone's picker offers first, as Android's own
// pickers open on internal storage rather than on "/". Only the ones that exist
// are offered.
var androidRoots = []struct{ name, path string }{
	{"Internal storage", "/storage/emulated/0"},
	{"Download", "/storage/emulated/0/Download"},
	{"DCIM", "/storage/emulated/0/DCIM"},
	{"Pictures", "/storage/emulated/0/Pictures"},
	{"Documents", "/storage/emulated/0/Documents"},
}

// browseRoots is the top of the tree: the phone folders that exist followed by
// "/", or on Windows one entry per drive letter that can be opened. The letters
// are probed, because a mapped drive whose server is asleep exists but cannot
// be opened.
func browseRoots() ([]browseEntry, error) {
	if runtime.GOOS != "windows" {
		out := []browseEntry{}
		for _, root := range androidRoots {
			if info, err := os.Stat(root.path); err == nil && info.IsDir() {
				out = append(out, browseEntry{Name: root.name, Path: root.path})
			}
		}
		return append(out, browseEntry{Name: "/", Path: "/"}), nil
	}
	out := []browseEntry{}
	for c := 'A'; c <= 'Z'; c++ {
		path := string(c) + `:\`
		if f, err := os.Open(path); err == nil {
			f.Close()
			out = append(out, browseEntry{Name: string(c) + ":", Path: path})
		}
	}
	return out, nil
}

// makeDir creates one folder inside the folder the picker has open. The name is
// a single segment: a separator, "." or ".." is refused rather than cleaned, so
// the folder cannot land somewhere else. Creation is not recursive, so a
// missing parent is an error.
func (s *Server) makeDir(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Parent string `json:"parent"`
		Name   string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, errors.New("a folder needs a name"))
		return
	}
	// Both separators on every platform, so a backslash cannot make a folder
	// literally named "sub\deeper" on Linux.
	if name == "." || name == ".." || strings.ContainsAny(name, `/`+"\\") {
		writeError(w, http.StatusBadRequest, fmt.Errorf("%q is a path, not a folder name", name))
		return
	}
	parent := filepath.Clean(body.Parent)
	if body.Parent == "" {
		writeError(w, http.StatusBadRequest, errors.New("there is no folder open to create one in"))
		return
	}

	made := filepath.Join(parent, name)
	// 0777 is only a ceiling that the umask cuts down; inheritFrom sets the
	// real mode and owner from the parent.
	if err := os.Mkdir(made, 0o777); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("create %s: %w", made, err))
		return
	}
	inheritFrom(parent, made)
	writeJSON(w, http.StatusOK, map[string]any{"path": made})
}
