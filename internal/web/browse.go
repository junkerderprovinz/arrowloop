package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// The folder picker lets a job's sides be picked rather than typed, since a
// mistyped path is a valid string and fails quietly. It is not confined to a
// root: a desktop build has to reach any folder its user can, and the API can
// already start a job that deletes files, which is why the desktop build
// listens on loopback and the container build listens on the network behind
// Guard.

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
	// Shown is how Path reads for a person, where the two differ: a drive is
	// stored by an identity nobody can read.
	Shown string `json:"shown,omitempty"`
}

// browse lists the folders inside one folder, on this machine or on a
// configured target. Files are left out, since a job's side is always a folder.
func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	at := r.URL.Query().Get("path")

	if strings.HasPrefix(at, volume.Prefix) {
		browseVolume(w, at)
		return
	}

	if name, dir, ok := remotes.Split(at); ok {
		if dir == "" {
			dir = remotes.Root(name)
		}
		folders, err := remotes.Folders(r.Context(), name, dir)
		if err != nil {
			http.Error(w, "cannot read "+at+": "+err.Error(), http.StatusBadRequest)
			return
		}
		out := make([]browseEntry, 0, len(folders))
		for _, f := range folders {
			out = append(out, browseEntry{Name: f, Path: remotes.Join(name, path.Join(dir, f))})
		}
		writeJSON(w, http.StatusOK, browseAnswer{Path: remotes.Join(name, dir), Parent: remotes.Parent(name, dir), Entries: out})
		return
	}

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

	names, err := subfolders(at)
	if err != nil {
		http.Error(w, "cannot read "+at+": "+err.Error(), http.StatusBadRequest)
		return
	}
	out := make([]browseEntry, 0, len(names))
	for _, name := range names {
		out = append(out, browseEntry{Name: name, Path: filepath.Join(at, name)})
	}
	writeJSON(w, http.StatusOK, browseAnswer{Path: at, Parent: parentOf(at), Entries: out})
}

// browseVolume lists a folder on a marked drive and answers in drive paths, so
// a job keeps finding the folder after the drive has changed its letter.
func browseVolume(w http.ResponseWriter, at string) {
	id, sub := splitVolume(at)
	dir, err := volume.Resolve(volume.Prefix + id + "/" + sub)
	if err != nil {
		http.Error(w, "cannot read "+volume.Describe(at)+": "+err.Error(), http.StatusBadRequest)
		return
	}
	names, err := subfolders(dir)
	if err != nil {
		http.Error(w, "cannot read "+volume.Describe(at)+": "+err.Error(), http.StatusBadRequest)
		return
	}
	here := volume.Prefix + id + "/" + sub
	out := make([]browseEntry, 0, len(names))
	for _, name := range names {
		out = append(out, browseEntry{Name: name, Path: volume.Prefix + id + "/" + path.Join(sub, name)})
	}
	// The top of the drive leads up to the list of drives.
	parent := ""
	if sub != "" {
		parent = volume.Prefix + id + "/" + strings.TrimPrefix(path.Dir("/"+sub), "/")
	}
	writeJSON(w, http.StatusOK, browseAnswer{Path: here, Parent: parent, Entries: out, Shown: volume.Describe(here)})
}

// splitVolume parts a drive path into the drive's identity and a folder on
// it. The folder is cleaned, so ".." cannot lead off the drive.
func splitVolume(at string) (id, sub string) {
	id, sub, _ = strings.Cut(strings.TrimPrefix(at, volume.Prefix), "/")
	return id, strings.Trim(path.Clean("/"+sub), "/")
}

// subfolders lists the folders in dir by name, without the hidden ones.
func subfolders(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			out = append(out, e.Name())
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	return out, nil
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
// "/", or on Windows one entry per drive letter that can be opened, followed
// by the network shares connected without a letter. The letters are probed,
// because a mapped drive whose server is asleep exists but cannot be opened.
// A mapped letter carries its share's address, which is how Explorer names it.
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
	// Without the shares the drives are still worth offering.
	shares, _ := listShares()
	mapped := map[string]string{}
	for _, sh := range shares {
		if sh.Letter != "" {
			mapped[strings.ToUpper(sh.Letter)] = sh.Path
		}
	}
	out := []browseEntry{}
	for c := 'A'; c <= 'Z'; c++ {
		letter := string(c) + ":"
		root := letter + `\`
		if f, err := os.Open(root); err == nil {
			f.Close()
			name := letter
			if unc := mapped[letter]; unc != "" {
				name = letter + " " + unc
			}
			out = append(out, browseEntry{Name: name, Path: root})
		}
	}
	for _, sh := range shares {
		if sh.Letter == "" {
			out = append(out, browseEntry{Name: sh.Path, Path: sh.Path + `\`})
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
	if body.Parent == "" {
		writeError(w, http.StatusBadRequest, errors.New("there is no folder open to create one in"))
		return
	}
	if strings.HasPrefix(body.Parent, volume.Prefix) {
		id, sub := splitVolume(body.Parent)
		dir, err := volume.Resolve(volume.Prefix + id + "/" + sub)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := os.Mkdir(filepath.Join(dir, name), 0o777); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("create %s: %w", volume.Describe(body.Parent)+"/"+name, err))
			return
		}
		inheritFrom(dir, filepath.Join(dir, name))
		writeJSON(w, http.StatusOK, map[string]any{"path": volume.Prefix + id + "/" + path.Join(sub, name)})
		return
	}
	if target, dir, ok := remotes.Split(body.Parent); ok {
		made, err := remotes.MakeFolder(r.Context(), target, dir, name)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("create %s: %w", remotes.Join(target, path.Join(dir, name)), err))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"path": made})
		return
	}
	parent := filepath.Clean(body.Parent)

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
