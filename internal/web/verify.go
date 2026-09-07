package web

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/junkerderprovinz/arrowloop/internal/verify"
)

// verifyJob reads both sides fresh and reports where they disagree with the
// record.
//
// The button behind this exists for the one failure a run cannot report on
// itself. A state row says the two sides agreed on a file, and every later run
// is decided against that row, so a row that is wrong goes on matching both
// sides for ever: the run finds nothing to do, says so as a success, and the
// two folders stay different. Nothing in the log ever mentions it.
//
// GET, unlike the precheck route next door, and the difference is what each of
// them does rather than what each of them costs. The precheck writes a probe
// file to prove a side is writable, and a GET that puts a file anywhere is a
// GET a cache or a link prefetcher is entitled to fire on somebody's behalf.
// This one changes nothing at all: it lists both sides and reads the record,
// which is exactly what the preview does, and the preview is a GET.
func (s *Server) verifyJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	j, ok := s.Runner.Config().Find(name)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}

	// checksums=true reads the content of every file on both sides instead of
	// judging by size and modification time. It is off unless it is asked for
	// because it reads both trees end to end, which on a large job over a
	// network takes longer than the sync itself. The report carries which of
	// the two it did, because a run without checksums cannot prove two files
	// are the same, only that the engine will never notice a difference, and a
	// screen that could not tell the two answers apart would present the
	// weaker one as the stronger.
	opt := verify.Opts{Checksums: r.URL.Query().Get("checksums") == "true"}

	// An unreadable limit is refused rather than quietly replaced by the
	// default. Somebody who asked for a different bound and silently got the
	// standard one would read a truncated list believing it was the list they
	// asked for.
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("limit %q is not a number", raw))
			return
		}
		opt.Limit = n
	}

	// The browser tab is not the check's owner, but it IS the only thing
	// waiting for the answer, so the request's own context is the right one:
	// somebody who navigates away should stop a listing that now has nobody to
	// report to. This is the opposite of a run, which must survive the tab that
	// started it because it is moving files.
	report, err := verify.Check(r.Context(), j, opt)
	if err != nil {
		// An error here means the comparison could not be made: a side that
		// would not open, a record that is not there, a share that lists
		// nothing while the record says it holds files. Answering 200 with an
		// empty list of findings, the way the precheck answers its own bad
		// news, would be a clean bill of health from a check that never ran,
		// which is the very failure this route exists to catch.
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, report)
}
