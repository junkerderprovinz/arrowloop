package web

import (
	"fmt"
	"net/http"

	"github.com/junkerderprovinz/arrowloop/internal/precheck"
)

// checkJob answers "could this job run right now" for one job.
//
// The button behind this exists because everything it asks is invisible from
// the job list. A share mounted read-only, a state database on a disk that has
// been swapped, a destination with less room left than the next run needs: all
// three look exactly like a healthy job until the run that was supposed to
// happen overnight does not.
//
// POST rather than GET, and for the same reason the remote check is a POST:
// proving a side can be written to means writing to it, briefly, under the
// tool's own reserved directory. A GET that puts a file anywhere is a GET that
// a cache or a link prefetcher is entitled to fire on somebody's behalf.
func (s *Server) checkJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	j, ok := s.Runner.Config().Find(name)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}

	// estimate=false skips the listing pass that works out how many bytes the
	// next run would move. That pass is the same work a preview does, which is
	// minutes on a large tree over SFTP, and somebody who only wants to know
	// whether their share is mounted should not have to wait for it. The report
	// then says the space question went unmeasured rather than leaving a screen
	// to assume it passed.
	opt := precheck.Opts{NoEstimate: r.URL.Query().Get("estimate") == "false"}

	// The browser tab is not the check's owner, but it IS the only thing
	// waiting for the answer, so the request's own context is the right one
	// here: somebody who navigates away should stop a listing that now has
	// nobody to report to. This is the opposite of a run, which must survive
	// the tab that started it because it is moving files.
	report := precheck.Check(r.Context(), j, opt)

	// Deliberately 200 with a verdict rather than an error status, exactly as
	// the remote check does. A job with an unplugged drive is an ANSWER to the
	// question that was asked, not a failure of the request, and a screen that
	// had to read the status code to find out whether to parse the body would
	// lose every finding in the interesting case.
	writeJSON(w, http.StatusOK, report)
}
