package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/importer"
	"github.com/junkerderprovinz/arrowloop/internal/remotes"
)

// The codes a file that cannot be imported is refused with, so the interface
// can say why in the reader's language.
const (
	importUnknown    = "import-unknown"
	importOldProfile = "import-old-profile"
)

// checkImport reads a file from another program and answers what importing
// it would add, under the names it would get here, without saving anything.
func (s *Server) checkImport(w http.ResponseWriter, r *http.Request) {
	p, err := s.importPlan(r)
	if err != nil {
		refuseImport(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func refuseImport(w http.ResponseWriter, err error) {
	body := map[string]string{"error": err.Error()}
	switch {
	case errors.Is(err, importer.ErrUnknown):
		body["code"] = importUnknown
	case errors.Is(err, importer.ErrOldProfile):
		body["code"] = importOldProfile
	}
	writeJSON(w, http.StatusBadRequest, body)
}

// applyImport adds what checkImport showed. The file is read again rather
// than the plan taken back, so a caller cannot slip a job past the mapping.
func (s *Server) applyImport(w http.ResponseWriter, r *http.Request) {
	s.saving.Lock()
	defer s.saving.Unlock()
	p, err := s.importPlan(r)
	if err != nil {
		refuseImport(w, err)
		return
	}
	if p.Source == importer.ArrowLoop {
		writeError(w, http.StatusBadRequest, errors.New("an ArrowLoop backup replaces the whole setup, so it goes through the restore"))
		return
	}
	s.backUpFirst()

	var made []string
	undo := func() {
		for _, name := range made {
			_ = remotes.Delete(name)
		}
	}
	for _, t := range p.Targets {
		if err := remotes.Create(t.Name, t.Type, t.Settings); err != nil {
			undo()
			writeError(w, http.StatusBadRequest, fmt.Errorf("create the target %s: %w", t.Name, err))
			return
		}
		made = append(made, t.Name)
	}
	next, err := s.Runner.Config().AddJobs(p.Jobs...)
	if err != nil {
		undo()
		writeError(w, http.StatusBadRequest, err)
		return
	}
	s.Runner.Reload(next)
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) importPlan(r *http.Request) (importer.Plan, error) {
	var body struct {
		File string `json:"file"`
	}
	// The file travels inside JSON, so it may be a little larger than the
	// four megabytes a restore takes.
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&body); err != nil {
		return importer.Plan{}, fmt.Errorf("send the file as {\"file\": \"...\"}: %w", err)
	}
	p, err := importer.Read([]byte(body.File))
	if err != nil {
		return p, err
	}

	cfg := s.Runner.Config()
	targets := map[string]bool{}
	for _, t := range remotes.List() {
		targets[t.Name] = true
	}
	importer.Settle(&p,
		func(name string) bool { _, ok := cfg.Find(name); return ok },
		func(name string) bool { return targets[name] })
	for _, j := range p.Jobs {
		j["state"] = "state/" + j["name"].(string) + ".db"
	}
	return p, nil
}
