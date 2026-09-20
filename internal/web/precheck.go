package web

import (
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/precheck"
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

	// The request's context, so navigating away stops the listing.
	report := precheck.Check(r.Context(), j, opt)

	// 200 with a verdict: an unplugged drive answers the question rather than
	// failing the request.
	writeJSON(w, http.StatusOK, report)
}
