package web

// The VPN settings: the providers, the tunnels set up with them and where
// each stands (internal/vpnconn). A login never comes back to the page.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/job"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

func (s *Server) vpnRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/vpn", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, s.VPN.State())
	})
	// Adding sets a new tunnel up with a provider, beside those there are.
	mux.HandleFunc("POST /api/vpn", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Provider string            `json:"provider"`
			Fields   map[string]string `json:"fields"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
			return
		}
		id, st, err := s.VPN.Add(body.Provider, body.Fields)
		if err != nil {
			writeVPNError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "state": st})
	})
	// Saving changes a tunnel's login. Empty fields keep what is stored.
	mux.HandleFunc("PUT /api/vpn/{id}", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Fields map[string]string `json:"fields"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("read the request: %w", err))
			return
		}
		st, err := s.VPN.Save(r.PathValue("id"), body.Fields)
		if err != nil {
			writeVPNError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	})
	mux.HandleFunc("DELETE /api/vpn/{id}", func(w http.ResponseWriter, r *http.Request) {
		st, err := s.VPN.Forget(r.PathValue("id"))
		if err != nil {
			writeVPNError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	})
	// The test brings the tunnel up as a run would and takes it down again.
	// A tunnel that does not come up is an answer, as a target's check is.
	mux.HandleFunc("POST /api/vpn/{id}/test", func(w http.ResponseWriter, r *http.Request) {
		st, err := s.VPN.Test(r.Context(), r.PathValue("id"))
		out := map[string]any{"ok": err == nil, "state": st}
		if err != nil {
			out["reason"] = err.Error()
		}
		writeJSON(w, http.StatusOK, out)
	})
}

// throughVPN is the runner's ThroughVPN for as long as ctx lasts, which for a
// request is until its handler returns: the job's sides are opened and read
// within it, so their connections go where the job's runs go.
func (s *Server) throughVPN(ctx context.Context, j job.Job) (context.Context, error) {
	ctx, done, err := s.Runner.ThroughVPN(ctx, j)
	if err != nil {
		return nil, err
	}
	context.AfterFunc(ctx, done)
	return ctx, nil
}

func writeVPNError(w http.ResponseWriter, err error) {
	var ref *vpnconn.Refusal
	if !errors.As(err, &ref) {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("the VPN login could not be stored: %w", err))
		return
	}
	out := map[string]any{"error": ref.Text, "code": ref.Code}
	values := map[string]string{}
	if ref.Field != "" {
		values["field"] = ref.Field
	}
	if ref.Line > 0 {
		values["line"], values["text"] = strconv.Itoa(ref.Line), ref.LineText
	}
	if len(values) > 0 {
		out["values"] = values
	}
	writeJSON(w, ref.Status, out)
}
