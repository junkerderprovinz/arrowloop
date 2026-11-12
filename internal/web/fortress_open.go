package web

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"path"
	"slices"
	"strings"
	"time"

	kitfortress "github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/status"

	"github.com/junkerderprovinz/arrowloop/internal/history"
)

// closedThroughFortress is the code a request of an opened page gets at a
// door it never passes.
const closedThroughFortress = "closed-through-fortress"

// openedPath reports whether a request goes to the pages the fortress opens
// here, which check their ticket themselves.
func openedPath(p string) bool {
	return strings.HasPrefix(p, kitfortress.OpenPath)
}

// closedPrefixes are the doors closed to a page another app opened through
// the fortress, each with what lies under it: whoever holds the phrase may
// try, so nothing there resets or replaces the way in, mints a key or a
// token, feeds a dashboard, or opens a page in turn.
var closedPrefixes = []string{
	"/api/security/reset",
	"/api/security/password",
	"/api/security/totp",
	"/api/security/read-tokens",
	"/api/passkeys/register",
	status.StatusPath,
	status.LogPath,
	"/api/fortress/open",
	"/api/fortress/members",
	strings.TrimSuffix(kitfortress.OpenPath, "/"),
}

// closedToOpened reports whether a request of an opened page goes through a
// closed door. The path is cleaned as in needsSession.
func closedToOpened(method, rawPath string) bool {
	p := path.Clean("/" + rawPath)
	if method == http.MethodDelete && strings.HasPrefix(p, "/api/passkeys/") {
		return true
	}
	return slices.ContainsFunc(closedPrefixes, func(c string) bool { return p == c || strings.HasPrefix(p, c+"/") })
}

// fortressUI is this instance's interface as the members of the fortress
// open it, nil where nobody else reaches it.
func (s *Server) fortressUI() *kitfortress.UI {
	if !s.canServe() {
		return nil
	}
	s.browserOnce.Do(func() { s.browser = s.Guard(s.Handler()) })
	return &kitfortress.UI{
		Handler: s.browser,
		SignIn:  func() bool { return len(s.passwordHash()) > 0 },
		Opened:  s.noteOpened,
	}
}

// noteOpened writes down that another app opened the interface, for this
// instance's log and the fortress's.
func (s *Server) noteOpened(from kitfortress.Caller) {
	app := from.App
	if f := s.fortressNow(); f != nil {
		for _, m := range f.Members() {
			if m.ID == from.ID && m.App.Name != "" {
				app = m.App.Name
			}
		}
	}
	short := from.ID[max(0, len(from.ID)-8):]
	s.logf("fortress: %s on %s (%s) opened this interface", app, from.Device, short)
	if s.History == nil {
		return
	}
	o := history.Opening{At: time.Now(), App: app, Device: from.Device, Member: from.ID}
	if err := s.History.RecordOpening(context.Background(), o); err != nil {
		s.logf("fortress: could not note that %s opened this interface: %v", app, err)
	}
}

// serveOpened answers at the fortress's path: the bar and the pages of
// another member a signed-in user opened from here.
func (s *Server) serveOpened(w http.ResponseWriter, r *http.Request) {
	f := s.fortressNow()
	if f == nil {
		http.NotFound(w, r)
		return
	}
	f.OpenHandler(s.passwordSession, nil).ServeHTTP(w, r)
}

// passwordSession names the session a request was signed in with, without
// the token itself, or reports that it carries none.
func (s *Server) passwordSession(r *http.Request) (string, bool) {
	token := cookieToken(r)
	if r.Header.Get(tokenHeader) != "" || len(s.passwordHash()) == 0 || !s.gate().accepts(token) {
		return "", false
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:]), true
}

// openMember opens another member's interface for the signed-in user and
// answers the path of the tab that shows it. Only a session signed in with
// the password opens one.
func (s *Server) openMember(w http.ResponseWriter, r *http.Request) {
	session, ok := s.passwordSession(r)
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "no_session", "error": "only a session signed in with the password opens another app"})
		return
	}
	f := s.fortressNow()
	if f == nil {
		writeFortressError(w, errNoFortress)
		return
	}
	token, gate := cookieToken(r), s.gate()
	ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
	defer cancel()
	opened, err := f.Open(ctx, kitfortress.Visit{
		Member:  r.PathValue("id"),
		Session: session,
		Valid:   func() bool { return gate.accepts(token) },
		Back:    basePrefix(r) + "settings/pairing",
	})
	if err != nil {
		s.writeOpenRefusal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": opened})
}

// writeOpenRefusal answers why a member did not open, or did not report,
// with a code the interface has words for.
func (s *Server) writeOpenRefusal(w http.ResponseWriter, err error) {
	status, code := http.StatusBadGateway, "failed"
	var no *kitfortress.Refusal
	switch {
	case errors.Is(err, group.ErrNoSuchMember):
		status, code = http.StatusNotFound, "unreachable"
	case errors.Is(err, group.ErrUnreachable):
		code = "unreachable"
	case errors.Is(err, kitfortress.ErrNoSuchAction):
		status, code = http.StatusNotFound, "no_ui"
	case errors.Is(err, kitfortress.ErrPermissionOff):
		status, code = http.StatusForbidden, "permission_off"
	case errors.As(err, &no) && no.Code == "ui_no_login":
		status, code = http.StatusForbidden, "ui_no_login"
	case errors.As(err, &no) && (no.Code == "busy" || no.Code == "jars_full"):
		status, code = http.StatusServiceUnavailable, "busy"
	default:
		s.logf("fortress: another member did not open: %v", err)
	}
	writeJSON(w, status, map[string]string{"code": code, "error": err.Error()})
}

// tailLines is how much of a member's log the status window shows,
// tailPages how many pages one look reads at most and maxTails how many logs
// are remembered.
const (
	tailLines = 10
	tailPages = 50
	maxTails  = 64
)

// logTail is the end of one member's log in one language, and where to read
// on from.
type logTail struct {
	next  string
	lines []status.LogEntry
}

// memberStatus answers the status report of another member and the end of
// its log, for a member Open shows as a window rather than its pages.
func (s *Server) memberStatus(w http.ResponseWriter, r *http.Request) {
	f := s.fortressNow()
	if f == nil {
		writeFortressError(w, errNoFortress)
		return
	}
	id, lang := r.PathValue("id"), r.URL.Query().Get("lang")
	ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
	defer cancel()
	report, err := f.Status(ctx, id, lang)
	if err != nil {
		s.writeOpenRefusal(w, err)
		return
	}
	lines := s.memberLog(ctx, f, id, lang)
	slices.Reverse(lines)
	writeJSON(w, http.StatusOK, map[string]any{"report": report, "log": lines})
}

// memberLog reads on in member id's log from where the last look ended and
// returns its last lines, oldest first. A log that does not come leaves the
// lines read before.
func (s *Server) memberLog(ctx context.Context, f *kitfortress.Fortress, id, lang string) []status.LogEntry {
	key := id + " " + lang
	s.tailsMu.Lock()
	t := s.tails[key]
	s.tailsMu.Unlock()
	if t == nil {
		t = &logTail{}
	}
	next, lines := t.next, slices.Clone(t.lines)
	for range tailPages {
		page, err := f.Log(ctx, id, status.LogQuery{After: next, Limit: status.MaxLogLimit, Lang: lang})
		if err != nil {
			break
		}
		lines = append(lines, page.Entries...)
		lines = lines[max(0, len(lines)-tailLines):]
		if page.Next == next || len(page.Entries) == 0 {
			break
		}
		next = page.Next
	}
	s.tailsMu.Lock()
	if s.tails == nil || len(s.tails) >= maxTails {
		s.tails = map[string]*logTail{}
	}
	s.tails[key] = &logTail{next: next, lines: lines}
	s.tailsMu.Unlock()
	return append([]status.LogEntry{}, lines...)
}
