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

// Browsing the machine's own folders, so a job's two sides can be picked rather
// than typed.
//
// Typing a path is where a job goes wrong quietly: a folder that does not exist
// yet is a perfectly valid string, and the first anybody hears of the typo is a
// run that copied nothing, or worse, one that created the wrong tree and
// synchronised it. A picker can only offer folders that are actually there.
//
// There is deliberately no root to be confined to. On Windows the top of the
// tree is a list of drive letters rather than a single directory, and on a
// desktop build the whole point is to reach any folder the person using the
// program can reach. That is not a new exposure: this same API can already
// start a job that deletes files, which is why the interface listens on
// loopback and says in its own documentation that anything else needs
// something in front of it.

type browseEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type browseAnswer struct {
	// Where the listing came from. Empty means the list of drives at the top of
	// a Windows tree, which has no path of its own.
	Path string `json:"path"`
	// The folder one level up, or empty when there is none. Given by the server
	// rather than worked out in the browser, because "one level up from C:\" is
	// a question with a different answer on every system.
	Parent  string        `json:"parent"`
	Entries []browseEntry `json:"entries"`
}

// browse lists the folders inside one folder.
//
// Files are left out on purpose. A job's side is always a folder, so listing
// files would be listing things that cannot be picked, and on a tree with
// thousands of them that is the whole answer buried.
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

	// Cleaned before use, so a path assembled in the browser cannot arrive with
	// a stray "..\" in the middle and mean something other than it reads.
	at = filepath.Clean(at)

	entries, err := os.ReadDir(at)
	if err != nil {
		// The message names the folder, because "permission denied" without it
		// is a sentence somebody has to guess the subject of.
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
	// ReadDir usually returns entries in name order and is not required to, so
	// they are sorted rather than assumed.
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })

	writeJSON(w, http.StatusOK, browseAnswer{Path: at, Parent: parentOf(at), Entries: out})
}

// parentOf is the folder above, or empty at the top.
//
// filepath.Dir answers itself at a root ("C:\" -> "C:\", "/" -> "/"), which
// would render an "up" entry that goes nowhere. Comparing against its own
// answer is how a root is recognised without hardcoding what one looks like on
// each system.
func parentOf(at string) string {
	up := filepath.Dir(at)
	if up == at {
		// At a Windows drive root, up is the list of drives rather than
		// nothing, which the empty path means everywhere in this handler.
		return ""
	}
	return up
}

// browseRoots is the top of the tree.
//
// One entry on a system with a single root, and one per attached drive on
// Windows. The letters are probed rather than read from an API, because the
// question this answers is not "which drives exist" but "which can be opened",
// and a mapped network drive whose server is asleep answers the first yes and
// the second no.
func browseRoots() ([]browseEntry, error) {
	if runtime.GOOS != "windows" {
		return []browseEntry{{Name: "/", Path: "/"}}, nil
	}
	// Empty rather than nil, so a machine that somehow opens no drive answers
	// with an empty list rather than with null.
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

// makeDir creates ONE folder inside the folder the picker currently has open.
//
// Two arguments, never one path: the parent is a folder the caller has already
// walked to and can list, and the name is a single segment. A separator or a
// "." or ".." in the name is refused rather than cleaned, because cleaning a
// name that was not meant to be a path is how a control that says "make a
// folder here" quietly makes one somewhere else. The parent is cleaned the same
// way browse cleans it, and creation is not recursive, so a parent that does
// not exist is an error rather than a tree appearing out of nowhere.
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
	// BOTH separators on every platform, not the host's own.
	//
	// filepath.Separator is "/" on Linux and macOS, so asking for that plus the
	// host separator asked twice for the same character and let a backslash
	// through: on those systems a folder literally named `sub\deeper` was
	// created inside the parent. It never escaped the parent, and it was still
	// not what "make a folder here" means. Windows treats both as separators,
	// which is why this was green on the machine it was written on and red on
	// the other two, and why the test that caught it had to run on all three.
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
	if err := os.Mkdir(made, 0o755); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("create %s: %w", made, err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": made})
}
