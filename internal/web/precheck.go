package web

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/daemon"
	"github.com/junkerderprovinz/arrowloop/internal/plan"
	"github.com/junkerderprovinz/arrowloop/internal/precheck"
	"github.com/junkerderprovinz/arrowloop/internal/volume"
	"github.com/junkerderprovinz/arrowloop/internal/vpnconn"
)

// checkJob answers whether one job could run right now, catching a read-only
// share, a swapped disk or too little room before a scheduled run fails. It is
// a POST because proving a side writable briefly writes a file to it.
func (s *Server) checkJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	j, ok := s.Runner.Config().Find(name)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}

	// estimate=false skips the listing that works out how many bytes the next
	// run would move, which can take minutes; the report then says the space
	// went unmeasured.
	opt := precheck.Opts{NoEstimate: r.URL.Query().Get("estimate") == "false"}

	// The request's context, so navigating away stops the listing. A tunnel
	// that does not come up leaves the sides that need it unreached, and a
	// folder on this machine is still checked.
	ctx, err := s.throughVPN(r.Context(), j)
	switch {
	case errors.Is(err, daemon.ErrVPNUnreached):
		ctx, opt.Unreached = r.Context(), map[plan.Side]error{}
		for side, spec := range map[plan.Side]string{plan.Left: j.Left, plan.Right: j.Right} {
			if path, rerr := volume.Resolve(spec); rerr == nil && !vpnconn.Offline(path) {
				opt.Unreached[side] = err
			}
		}
	case err != nil:
		writeError(w, http.StatusBadGateway, err)
		return
	}
	report := precheck.Check(ctx, j, opt)

	// 200 with a verdict: an unplugged drive answers the question rather than
	// failing the request.
	writeJSON(w, http.StatusOK, report)
}
