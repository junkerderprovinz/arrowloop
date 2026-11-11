package web

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"path"
	"strings"

	kitfortress "github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/hostpath"

	"github.com/junkerderprovinz/arrowloop/internal/remotes"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
)

// fortressTarget is a place another app can have a new job write to. Where
// says in a few words where it is, without a login.
type fortressTarget struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Where string `json:"where"`
	// side is the job side for a job called name, which gets a folder of its
	// own there so that a mirror or a move never touches the rest.
	side func(name string) string
}

func (s *Server) mountTable() (hostpath.Table, error) {
	if s.Mounts != nil {
		return s.Mounts()
	}
	return hostpath.Load()
}

// targets lists the folders shared into this container, the drives this
// engine knows and its remotes.
func (s *Server) targets(tab hostpath.Table) []fortressTarget {
	out := []fortressTarget{}
	own := s.Runner.Config().Dir()
	for _, m := range tab.Shared() {
		// Docker mounts single files under /etc, and the engine's own
		// configuration is nobody's target.
		if m.Point == "/" || strings.HasPrefix(m.Point, "/etc/") || strings.HasPrefix(own+"/", m.Point+"/") {
			continue
		}
		where, err := tab.ToHost(m.Point)
		if err != nil {
			continue
		}
		point := m.Point
		out = append(out, fortressTarget{
			ID: "share:" + point, Name: path.Base(point), Kind: "share", Where: where,
			side: func(name string) string { return path.Join(point, name) },
		})
	}
	for _, k := range volume.Remembered() {
		id := k.ID
		out = append(out, fortressTarget{
			ID: "disk:" + id, Name: cmp.Or(k.Label, id), Kind: "disk", Where: k.Mount,
			side: func(name string) string { return volume.Prefix + id + "/" + name },
		})
	}
	for _, r := range remotes.List() {
		where := cmp.Or(r.Provider, r.Type)
		for _, set := range r.Settings {
			if set.Key == "host" && !set.Secret && set.Value != "" {
				where += " " + set.Value
			}
		}
		remote := r.Name
		out = append(out, fortressTarget{
			ID: "remote:" + remote, Name: remote, Kind: "remote", Where: where,
			side: func(name string) string { return remote + ":" + name },
		})
	}
	return out
}

func (s *Server) fortressTargets(context.Context, kitfortress.Caller, []byte) ([]byte, error) {
	tab, err := s.mountTable()
	if err != nil {
		return nil, err
	}
	return json.Marshal(s.targets(tab))
}

// fortressCreate adds a job that carries a folder of the calling app, named
// by its host path, to one of the targets. The folder is the left side, and
// a mirror or a move runs from it to the target.
func (s *Server) fortressCreate(_ context.Context, from kitfortress.Caller, body []byte) ([]byte, error) {
	var req struct {
		Name, Source, Target, Mode string
	}
	if json.Unmarshal(body, &req) != nil {
		return nil, &kitfortress.Refusal{Code: "bad_request"}
	}
	name := strings.TrimSpace(req.Name)
	if checkJobName(name) != nil {
		return nil, &kitfortress.Refusal{Code: "bad_request"}
	}
	j := map[string]any{"name": name}
	switch req.Mode {
	case "mirror", "move":
		j["direction"], j["mode"] = "leftToRight", req.Mode
	case "sync":
	default:
		return nil, &kitfortress.Refusal{Code: "bad_request"}
	}

	tab, err := s.mountTable()
	if err != nil {
		return nil, err
	}
	left, err := tab.FromHost(req.Source)
	switch {
	case errors.Is(err, hostpath.ErrUnclean):
		return nil, &kitfortress.Refusal{Code: "bad_request"}
	case errors.Is(err, hostpath.ErrNotMounted):
		return nil, &kitfortress.Refusal{Code: "source_not_mounted"}
	case err != nil:
		return nil, err
	}
	var to *fortressTarget
	for _, t := range s.targets(tab) {
		if t.ID == req.Target {
			to = &t
		}
	}
	if to == nil {
		return nil, &kitfortress.Refusal{Code: "no_such_target"}
	}
	j["left"], j["right"] = left, to.side(name)

	_, err = s.addJob(j)
	var bad badJob
	switch {
	case errors.Is(err, errNameTaken):
		return nil, &kitfortress.Refusal{Code: "name_taken"}
	case errors.As(err, &bad):
		return nil, &kitfortress.Refusal{Code: "bad_request"}
	case err != nil:
		return nil, err
	}
	s.logf("%s on %s added the job %s, from %s to %s", from.App, from.Device, name, left, to.Where)
	return json.Marshal(map[string]string{"job": name})
}
